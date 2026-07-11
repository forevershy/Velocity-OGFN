const { spawn, execFile } = require("child_process");
const net = require("net");
const fs = require("fs");
const path = require("path");
const { createHash } = require("crypto");

const config = require("../config/config.json");
const log = require("../utils/logger");
const { injectDll, launchSuspendedWithDll } = require("./dll-inject");

let gameserverProcess = null;
let gameserverPid = null;
let starting = false;

/** Project Reboot starts hosting after F2/F3 — send both to the gameserver window. */
function pressRebootHostKeys(pid) {
  if (!pid) return Promise.resolve(false);
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class VelocityKeys {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern IntPtr GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  public static IntPtr FindMainWindow(uint pid) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => {
      uint wpid; GetWindowThreadProcessId(h, out wpid);
      if (wpid == pid) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
  public static void Tap(byte vk) {
    keybd_event(vk, 0, 0, UIntPtr.Zero);
    keybd_event(vk, 0, 2, UIntPtr.Zero);
  }
}
"@
\$hwnd = [VelocityKeys]::FindMainWindow(${pid})
if (\$hwnd -eq [IntPtr]::Zero) { exit 2 }
[VelocityKeys]::ShowWindow(\$hwnd, 9) | Out-Null
[VelocityKeys]::SetForegroundWindow(\$hwnd) | Out-Null
Start-Sleep -Milliseconds 400
[VelocityKeys]::Tap(0x71) # F2
Start-Sleep -Milliseconds 800
[VelocityKeys]::Tap(0x72) # F3
exit 0
`;
  return new Promise((resolve) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true, stdio: "ignore" }
    );
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

function accountIdFromName(name) {
  return createHash("md5").update(String(name).toLowerCase()).digest("hex");
}

function parseBuild(gamePath) {
  const m = String(gamePath || "").match(/(\d+)\.(\d+)/);
  if (!m) return 0;
  return parseFloat(`${m[1]}.${m[2]}`);
}

function getAntiCheatArgs(build) {
  if (build >= 27) return ["-nobe", "-fromfl=eac", "-fltoken=h1cdhchd10150221h130eB56"];
  if (build >= 23) return ["-nobe", "-noeaceos", "-fromfl=be"];
  if (build >= 19) return ["-nobe", "-fromfl=be"];
  if (build >= 8.51) return ["-nobe", "-fromfl=eac", "-fltoken=h1cdhchd10150221h130eB56"];
  if (build >= 7.3) return ["-noeac", "-fromfl=be", "-fltoken=db04e37196g0h6h8e003c19d"];
  return ["-noeac"];
}

function gsConfig(overrides = {}) {
  return { ...(config.gameserver || {}), ...overrides };
}

function logPath() {
  return path.join(
    process.env.VELOCITY_USER_DATA || path.join(process.env.APPDATA || "", "velocity-app"),
    "Gameserver.log"
  );
}

function appendLog(msg) {
  try {
    fs.mkdirSync(path.dirname(logPath()), { recursive: true });
    fs.appendFileSync(logPath(), `${msg}\n`);
  } catch {
    /* ignore */
  }
}

/** Fortnite gameserver uses UDP — TCP connect always fails even when the server is up. */
function isUdpPortBound(port) {
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `if (Get-NetUDPEndpoint -LocalPort ${Number(port)} -ErrorAction SilentlyContinue) { '1' } else { '0' }`,
      ],
      { windowsHide: true, timeout: 5000 },
      (err, stdout) => {
        if (err) {
          // Fallback: netstat
          execFile(
            "cmd.exe",
            ["/c", `netstat -ano | findstr ":${Number(port)}"`],
            { windowsHide: true, timeout: 5000 },
            (e2, out2) => {
              resolve(Boolean(out2 && String(out2).toUpperCase().includes("UDP")));
            }
          );
          return;
        }
        resolve(String(stdout).trim() === "1");
      }
    );
  });
}

function isPortOpen(port, host = "127.0.0.1", timeoutMs = 1500) {
  // Prefer UDP check; also try TCP in case a beacon listens.
  return isUdpPortBound(port).then(async (udp) => {
    if (udp) return true;
    return new Promise((resolve) => {
      const socket = new net.Socket();
      const done = (ok) => {
        socket.destroy();
        resolve(ok);
      };
      socket.setTimeout(timeoutMs);
      socket.once("connect", () => done(true));
      socket.once("timeout", () => done(false));
      socket.once("error", () => done(false));
      socket.connect(port, host);
    });
  });
}

async function waitForPort(port, host, timeoutMs = 120000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await isPortOpen(port, host)) return true;
    if (gameserverPid) {
      try {
        process.kill(gameserverPid, 0);
      } catch {
        return false;
      }
    }
    if (gameserverProcess && gameserverProcess.exitCode !== null) return false;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

function resolveDllPath(gs) {
  const candidates = [
    gs.dllPath,
    process.env.VELOCITY_GAMESERVER_DLL,
    path.join(process.env.LOCALAPPDATA || "", "RebootLauncher", "dlls", "reboot.dll"),
    path.join(process.env.VELOCITY_USER_DATA || "", "gameserver", "ProjectReboot.dll"),
    path.join(process.env.APPDATA || "", "velocity-app", "gameserver", "ProjectReboot.dll"),
    path.join(process.env.APPDATA || "", "reboot-launcher", "dlls", "ProjectReboot.dll"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return gs.dllPath || process.env.VELOCITY_GAMESERVER_DLL || "";
}

function buildServerArgs({ username, accountId, build, gs, playlist }) {
  const port = gs.port || 7777;
  const pl = playlist || gs.playlist || "Playlist_DefaultSolo";

  // Reboot hosts by injecting into a normal client process (not a pure -server binary).
  // Keep -log so Reboot can write; avoid -nullrhi so older builds stay alive.
  return [
    "-log",
    "-nosteam",
    "-nosound",
    "-messaging",
    ...getAntiCheatArgs(build),
    "-skippatchcheck",
    "-HTTP=WinInet",
    `-AUTH_LOGIN=${username}`,
    "-AUTH_PASSWORD=ogfn",
    "-AUTH_TYPE=epic",
    "-epicapp=Fortnite",
    "-epicenv=Prod",
    "-epiclocale=en-US",
    `-epicusername=${username}`,
    `-epicuserid=${accountId}`,
    "-epicportal",
    `-PORT=${port}`,
    `-Playlist=${pl}`,
  ];
}

function stopGameserver() {
  if (gameserverPid) {
    try {
      spawn("taskkill", ["/F", "/PID", String(gameserverPid), "/T"], { windowsHide: true, stdio: "ignore" });
    } catch {
      /* ignore */
    }
  }
  if (gameserverProcess) {
    try {
      gameserverProcess.kill();
    } catch {
      /* ignore */
    }
  }
  gameserverProcess = null;
  gameserverPid = null;
}

async function ensureGameserver(overrides = {}) {
  if (!config.bEnableMatchmaking) return { ok: true, skipped: true };
  const gs = gsConfig(overrides);
  if (gs.autoStart === false) return { ok: true, skipped: true };
  if (starting) {
    // Another ensure is in progress — wait for it.
    const port = Number(gs.port || 7777);
    const host = gs.ip || "127.0.0.1";
    const ready = await waitForPort(port, host, 120000);
    return ready ? { ok: true, alreadyRunning: true } : { ok: false, reason: "Gameserver start already in progress and timed out." };
  }

  const gamePath = gs.gamePath || process.env.VELOCITY_GAME_PATH;
  const username = process.env.VELOCITY_USERNAME || config.owner?.username || "VelocityPlayer";
  const accountId = config.owner?.accountId || accountIdFromName(username);
  const build = parseBuild(gamePath);
  const port = Number(gs.port || 7777);
  const host = gs.ip || "127.0.0.1";

  if (build >= 23) {
    return { ok: true, skipped: true, reason: "Chapter 4+ builds need a separate gameserver host." };
  }

  if (!gamePath || !fs.existsSync(gamePath)) {
    return { ok: false, reason: "Game executable not set for gameserver (VELOCITY_GAME_PATH)." };
  }

  if (await isPortOpen(port, host)) {
    return { ok: true, alreadyRunning: true };
  }

  const dllPath = resolveDllPath(gs);
  const needsDll = build < 15;
  if (needsDll && (!dllPath || !fs.existsSync(dllPath))) {
    log.matchmaker(
      "Chapter 1 gameserver needs Project Reboot DLL — set gameserver.dllPath in config."
    );
    return {
      ok: false,
      needsDll: true,
      reason:
        "Chapter 1 (v4.5) needs a Project Reboot gameserver DLL. Set gameserver.dllPath in config.",
    };
  }

  starting = true;
  stopGameserver();

  const win64 = path.dirname(gamePath);
  const args = buildServerArgs({ username, accountId, build, gs, playlist: overrides.playlist });

  try {
    appendLog(`\n[${new Date().toISOString()}] Starting gameserver build=${build} port=${port}`);
    appendLog(args.join(" "));

    // Launch visible client, wait for engine init, then inject Reboot (suspended inject dies on 4.5).
    const logFd = fs.openSync(logPath(), "a");
    gameserverProcess = spawn(gamePath, args, {
      cwd: win64,
      detached: true,
      stdio: ["ignore", logFd, logFd],
      windowsHide: false,
    });
    gameserverProcess.unref();
    const pid = gameserverProcess.pid;
    gameserverPid = pid;
    gameserverProcess.on("exit", () => {
      gameserverProcess = null;
      gameserverPid = null;
      try {
        fs.closeSync(logFd);
      } catch {
        /* ignore */
      }
    });

    if (dllPath && fs.existsSync(dllPath) && pid) {
      await new Promise((r) => setTimeout(r, 12000));
      const injected = await injectDll(pid, dllPath);
      appendLog(`inject pid=${pid} ok=${injected}`);
      log.matchmaker(injected ? `Injected Reboot into PID ${pid}` : `Inject failed for PID ${pid}`);
      // Reboot opens the gameserver after F2/F3.
      await new Promise((r) => setTimeout(r, 8000));
      for (let i = 0; i < 3; i++) {
        const keyed = await pressRebootHostKeys(pid);
        appendLog(`host keys attempt ${i + 1}: ${keyed}`);
        if (await isPortOpen(port, host)) break;
        await new Promise((r) => setTimeout(r, 5000));
      }
    }

    const ready = await waitForPort(port, host, 90000);
    starting = false;
    if (ready) {
      log.matchmaker(`Gameserver listening on ${host}:${port}`);
      appendLog(`READY on ${host}:${port}`);
      return { ok: true, started: true, pid };
    }

    appendLog("NOT READY — port never opened");
    return {
      ok: false,
      reason: needsDll
        ? "Gameserver did not open port 7777. In the gameserver Fortnite window, press F2 or F3 to start hosting, or use Reboot Launcher → Host."
        : "Gameserver did not open port 7777. Check Gameserver.log.",
    };
  } catch (err) {
    starting = false;
    return { ok: false, reason: err.message };
  }
}

async function gameserverStatus() {
  const gs = gsConfig();
  const port = Number(gs.port || 7777);
  const host = gs.ip || "127.0.0.1";
  const listening = await isPortOpen(port, host);
  const dllPath = resolveDllPath(gs);
  return {
    listening,
    port,
    host,
    processTracked: Boolean(gameserverPid),
    pid: gameserverPid,
    dllPath: dllPath || null,
    dllFound: Boolean(dllPath && fs.existsSync(dllPath)),
  };
}

module.exports = { ensureGameserver, stopGameserver, isPortOpen, gameserverStatus };
