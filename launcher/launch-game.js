// Safe Fortnite launch — version-aware anti-cheat and launcher mediation.
// Chapter 4+ (23+) uses FortniteLauncher + Caldera; do not rename EAC folders (breaks UE5).
const { spawn, exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const { spawnWithParent, waitForProcessPid } = require("./spawn-with-parent");
const {
  resolveBuildNumber,
  shouldBlockAntiCheatFiles,
  shouldUseLauncherStub,
  shouldSuppressEpicLauncher,
  needsLauncherProcess,
  shouldLaunchShippingDirect,
  usesLibCurlHttp,
} = require("./launch-profiles");
const { ensureLibCurlSslFix, unlockSavedEngineIni } = require("./libcurl-ssl");

const { ensureEacEosWrapper } = require("./eac-eos-shim");

const OFF_SUFFIX = ".velocity-off";
const SHIPPING_EXE = "FortniteClient-Win64-Shipping.exe";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function runCmd(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { windowsHide: true }, () => resolve());
  });
}

const { isProcessRunning, isFortniteGameRunning } = require("./process-utils");

async function killEpicLauncher() {
  await runCmd("taskkill /F /IM EpicGamesLauncher.exe /T 2>nul");
}

async function killInterferingProcesses(build = 0) {
  const light = build >= 23;
  const cmds = [
    light ? null : "taskkill /F /IM EpicGamesLauncher.exe /T",
    "taskkill /F /IM FortniteLauncher.exe /T",
    "taskkill /F /IM FortniteClient-Win64-Shipping.exe /T",
    light ? null : "taskkill /F /IM FortniteClient-Win64-Shipping_EAC.exe /T",
    light ? null : "taskkill /F /IM FortniteClient-Win64-Shipping_EAC_EOS.exe /T",
    light ? null : "taskkill /F /IM EasyAntiCheat_EOS.exe /T",
    light ? null : "taskkill /F /IM EasyAntiCheat_Setup.exe /T",
    light ? null : "taskkill /F /IM BEService.exe /T",
    light ? null : "taskkill /F /IM BEServices.exe /T",
    light ? null : "sc stop EasyAntiCheat_EOS",
    light ? null : "sc stop BEService",
  ].filter(Boolean);
  for (const cmd of cmds) await runCmd(`${cmd} 2>nul`);
}

function gameRootFromWin64(win64) {
  return path.dirname(path.dirname(path.dirname(win64)));
}

function disablePath(target) {
  if (!fs.existsSync(target)) return null;
  const offPath = target + OFF_SUFFIX;
  if (fs.existsSync(offPath)) return { target, offPath, disabled: false };
  try {
    fs.renameSync(target, offPath);
    return { target, offPath, disabled: true };
  } catch {
    return null;
  }
}

function restorePath(entry) {
  if (!entry?.disabled) return;
  try {
    if (fs.existsSync(entry.target)) fs.rmSync(entry.target, { recursive: true, force: true });
    if (fs.existsSync(entry.offPath)) fs.renameSync(entry.offPath, entry.target);
  } catch {
    /* best effort */
  }
}

function blockAntiCheat(win64) {
  const root = gameRootFromWin64(win64);
  const entries = [];

  for (const target of [
    path.join(win64, "FortniteClient-Win64-Shipping_EAC.exe"),
    path.join(win64, "FortniteClient-Win64-Shipping_EAC_EOS.exe"),
    path.join(root, "EasyAntiCheat"),
    path.join(root, "FortniteGame", "Binaries", "Win64", "EasyAntiCheat"),
    path.join(root, "FortniteGame", "Binaries", "ThirdParty", "EasyAntiCheat"),
  ]) {
    const entry = disablePath(target);
    if (entry) entries.push(entry);
  }

  return () => {
    for (const entry of entries) restorePath(entry);
  };
}

function buildProcessStub(cacheDir, fileName) {
  const stubPath = path.join(cacheDir, fileName);
  if (fs.existsSync(stubPath) && fs.statSync(stubPath).size > 2048) return Promise.resolve(stubPath);

  fs.mkdirSync(cacheDir, { recursive: true });
  const safeOut = stubPath.replace(/'/g, "''");
  const script = `
$out = '${safeOut}'
try {
  if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force }
  Add-Type -TypeDefinition @'
using System;
using System.Threading;
public class VelocityProcessStub {
  public static void Main() {
    Thread.Sleep(Timeout.Infinite);
  }
}
'@ -OutputAssembly $out -OutputType ConsoleApplication
  if (Test-Path -LiteralPath $out) { exit 0 } else { exit 1 }
} catch { exit 1 }
`;

  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true, stdio: "ignore" }
    );
    child.on("close", (code) => {
      if (code === 0 && fs.existsSync(stubPath)) resolve(stubPath);
      else reject(new Error(`Could not build ${fileName}.`));
    });
    child.on("error", reject);
  });
}

function ensureLauncherStub(cacheDir) {
  return buildProcessStub(cacheDir, "FortniteLauncher-stub.exe");
}

function ensureEpicLauncherStub(cacheDir) {
  return buildProcessStub(cacheDir, "EpicGamesLauncher-stub.exe");
}

async function killCacheEpicStub() {
  await runCmd("taskkill /F /IM EpicGamesLauncher.exe /T 2>nul");
  await sleep(400);
}

async function prepareEpicStubRunner(cacheDir, stubSrc) {
  const epicRun = path.join(cacheDir, "EpicGamesLauncher.exe");
  fs.mkdirSync(cacheDir, { recursive: true });

  if (fs.existsSync(epicRun) && fs.existsSync(stubSrc)) {
    try {
      if (fs.statSync(epicRun).size === fs.statSync(stubSrc).size) {
        return epicRun;
      }
    } catch {
      /* replace below */
    }
  }

  await killCacheEpicStub();

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.copyFileSync(stubSrc, epicRun);
      return epicRun;
    } catch (err) {
      const locked = err?.code === "EBUSY" || err?.code === "EPERM";
      if (!locked) throw err;
      await killCacheEpicStub();
      await sleep(300 * (attempt + 1));
    }
  }

  const tmpRun = epicRun + ".new";
  fs.copyFileSync(stubSrc, tmpRun);
  try {
    if (fs.existsSync(epicRun)) fs.unlinkSync(epicRun);
  } catch {
    await killCacheEpicStub();
    await sleep(500);
    if (fs.existsSync(epicRun)) fs.unlinkSync(epicRun);
  }
  fs.renameSync(tmpRun, epicRun);
  return epicRun;
}

async function startEpicLauncherStub(cacheDir) {
  const stubSrc = await ensureEpicLauncherStub(cacheDir);
  const epicRun = await prepareEpicStubRunner(cacheDir, stubSrc);

  const { getProcessPid } = require("./spawn-with-parent");
  const existingPid = await getProcessPid("EpicGamesLauncher.exe");
  if (existingPid) return existingPid;

  return new Promise((resolve, reject) => {
    const child = spawn(epicRun, [], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      shell: false,
    });
    child.on("error", reject);
    child.on("spawn", () => {
      child.unref();
      resolve(child.pid || 0);
    });
  });
}

function installLauncherStub(win64, stubPath) {
  const launcherExe = path.join(win64, "FortniteLauncher.exe");
  const backup = launcherExe + OFF_SUFFIX;
  if (!fs.existsSync(launcherExe)) {
    return () => {};
  }

  try {
    if (!fs.existsSync(backup)) fs.copyFileSync(launcherExe, backup);
    fs.copyFileSync(stubPath, launcherExe);
  } catch {
    return () => {};
  }

  return () => {
    try {
      if (fs.existsSync(backup)) fs.copyFileSync(backup, launcherExe);
    } catch {
      /* ignore */
    }
  };
}

async function waitForShipping(timeoutMs = 60000, { suppressEpic = true } = {}) {
  const steps = Math.ceil(timeoutMs / 500);
  for (let i = 0; i < steps; i++) {
    if (suppressEpic) await killEpicLauncher();
    if (await isProcessRunning(SHIPPING_EXE)) return true;
    await sleep(500);
  }
  return false;
}

function restoreRealLauncherIfStubbed(win64) {
  const launcherExe = path.join(win64, "FortniteLauncher.exe");
  const backup = launcherExe + OFF_SUFFIX;
  if (!fs.existsSync(backup)) return;
  try {
    fs.copyFileSync(backup, launcherExe);
  } catch {
    /* ignore */
  }
}

// Stripped Ch5 builds omit the real EAC EOS bootstrapper — install our wrapper exe.
function ensureEacBootstrap(win64, shippingExe, cacheDir) {
  ensureEacEosWrapper(cacheDir, win64);
  ensureEacSettingsStub(win64);
}

function ensureEacSettingsStub(win64) {
  const eacDir = path.join(win64, "EasyAntiCheat");
  const settingsPath = path.join(eacDir, "Settings.json");
  if (fs.existsSync(settingsPath)) return;

  try {
    fs.mkdirSync(eacDir, { recursive: true });
    fs.writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          productid: "Fortnite",
          executable: SHIPPING_EXE,
          title: "Fortnite",
        },
        null,
        2
      ),
      "utf8"
    );
  } catch {
    /* optional — FL logs a warning but can still proceed */
  }
}

async function launchViaFortniteLauncher(win64, shippingExe, args, cacheDir) {
  const launcherExe = path.join(win64, "FortniteLauncher.exe");
  if (!fs.existsSync(launcherExe)) {
    throw new Error("FortniteLauncher.exe not found — Chapter 4+ builds require it.");
  }

  ensureEacBootstrap(win64, shippingExe, cacheDir);

  // Epic stub -> FortniteLauncher -> shipping (FortniteLauncher must spawn the game).
  const epicPid = await startEpicLauncherStub(cacheDir);
  if (!epicPid) {
    throw new Error("Could not start the Epic Games Launcher stub.");
  }
  await sleep(500);

  const launchArgs = ["-launch", "-App=Fortnite", ...args];
  const launcherPid = await spawnWithParent(cacheDir, epicPid, launcherExe, win64, launchArgs);
  if (!launcherPid) {
    throw new Error("FortniteLauncher did not start.");
  }

  // Wait for FortniteLauncher to spawn shipping (can take 30–90s on UE5 builds).
  for (let i = 0; i < 180; i++) {
    await sleep(500);
    if (await isFortniteGameRunning()) {
      return { pid: launcherPid };
    }
  }

  throw new Error(
    "FortniteLauncher did not start the game. Check that Game connection is set up and restart Velocity."
  );
}

async function launchFortnite(shippingExe, args, { stubCacheDir, cfg, certDir, waitUntilRunning = true } = {}) {
  if (!fs.existsSync(shippingExe)) {
    throw new Error("FortniteClient-Win64-Shipping.exe not found.");
  }

  const win64 = path.dirname(shippingExe);
  const cacheDir = stubCacheDir || path.join(process.env.APPDATA || "", "velocity-launcher", "cache");
  const build = resolveBuildNumber(cfg, shippingExe);
  const blockAcbFiles = shouldBlockAntiCheatFiles(build);
  const useLauncherStub = shouldUseLauncherStub(build);
  const useDirectShipping = shouldLaunchShippingDirect(build);
  const useLauncherMediation = needsLauncherProcess(build) && !useDirectShipping;
  const suppressEpic = shouldSuppressEpicLauncher(build);

  let libCurlEnv = {};
  if (usesLibCurlHttp(build)) {
    const resolvedCertDir =
      certDir ||
      process.env.VELOCITY_CERT_DIR ||
      path.join(process.env.APPDATA || "", "velocity-app", "certs");
    const sslFix = await ensureLibCurlSslFix(shippingExe, resolvedCertDir);
    libCurlEnv = sslFix.env || {};
  }

  if (useLauncherMediation || !useLauncherStub) restoreRealLauncherIfStubbed(win64);

  await killInterferingProcesses(build);
  if (useLauncherMediation) await killCacheEpicStub();

  let restoreLauncher = () => {};
  if (useLauncherStub) {
    try {
      const stubPath = await ensureLauncherStub(cacheDir);
      restoreLauncher = installLauncherStub(win64, stubPath);
    } catch {
      /* older builds may still start with direct args */
    }
  }

  const restoreAcb = blockAcbFiles ? blockAntiCheat(win64) : () => {};
  const epicGuard = suppressEpic ? setInterval(killEpicLauncher, 800) : null;

  try {
    const child = useLauncherMediation
      ? await launchViaFortniteLauncher(win64, shippingExe, args, cacheDir)
      : spawn(shippingExe, args, {
          cwd: win64,
          detached: true,
          stdio: "ignore",
          windowsHide: false,
          shell: false,
          env: { ...process.env, ...libCurlEnv },
        });

    if (!useLauncherMediation) child.unref();

    const releaseLibCurlLock = () => {
      if (usesLibCurlHttp(build)) unlockSavedEngineIni();
    };

    if (!waitUntilRunning) {
      setTimeout(() => {
        if (epicGuard) clearInterval(epicGuard);
        restoreAcb();
        if (useLauncherStub) restoreLauncher();
        releaseLibCurlLock();
      }, 120000);
      return child;
    }

    const started = await waitForShipping(blockAcbFiles ? 60000 : 90000, { suppressEpic });
    if (started) {
      if (epicGuard) clearInterval(epicGuard);
      setTimeout(() => {
        restoreAcb();
        if (useLauncherStub) restoreLauncher();
        releaseLibCurlLock();
      }, 45000);
      return child;
    }

    if (epicGuard) clearInterval(epicGuard);
    restoreAcb();
    if (useLauncherStub) restoreLauncher();
    releaseLibCurlLock();
    throw new Error(
      "Fortnite did not start. Open Settings → Game connection, run Set up connection as Administrator, then try Play again."
    );
  } catch (err) {
    if (epicGuard) clearInterval(epicGuard);
    restoreAcb();
    if (useLauncherStub) restoreLauncher();
    if (usesLibCurlHttp(build)) unlockSavedEngineIni();
    throw err;
  }
}

module.exports = { launchFortnite };
