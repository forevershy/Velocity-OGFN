const { spawn, execFile } = require("child_process");
const net = require("net");
const fs = require("fs");
const path = require("path");
const http = require("http");

const config = require("../config/config.json");
const log = require("../utils/logger");
const { injectDll } = require("./dll-inject");
const {
  parseBuild,
  resolveGamePath,
  resolveUsername,
  resolveAccountId,
  buildGameserverArgs,
} = require("./gameserverLaunch");

let gameserverProcess = null;
let gameserverPid = null;
let starting = false;

function fetchExchangeCode(username) {
  return new Promise((resolve) => {
    const port = config.server?.port || 3551;
    const url = `http://127.0.0.1:${port}/account/api/oauth/exchange?username=${encodeURIComponent(username)}`;
    const req = http.get(url, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data).code || "");
        } catch {
          resolve("");
        }
      });
    });
    req.on("error", () => resolve(""));
    req.setTimeout(5000, () => {
      req.destroy();
      resolve("");
    });
  });
}

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
$hwnd = [VelocityKeys]::FindMainWindow(${pid})
if ($hwnd -eq [IntPtr]::Zero) { exit 2 }
[VelocityKeys]::ShowWindow($hwnd, 9) | Out-Null
[VelocityKeys]::SetForegroundWindow($hwnd) | Out-Null
Start-Sleep -Milliseconds 500
[VelocityKeys]::Tap(0x72) # F3 host
Start-Sleep -Milliseconds 400
[VelocityKeys]::Tap(0x71) # F2 backup
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
          execFile(
            "cmd.exe",
            ["/c", `netstat -ano | findstr ":${Number(port)}"`],
            { windowsHide: true, timeout: 5000 },
            (e2, out2) => resolve(Boolean(out2 && String(out2).toUpperCase().includes("UDP")))
          );
          return;
        }
        resolve(String(stdout).trim() === "1");
      }
    );
  });
}

function isPortOpen(port, host = "127.0.0.1", timeoutMs = 1500) {
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
  if (!config.bEnableMatchmaking) return { ok: false, reason: "Matchmaking is disabled." };

  const gs = gsConfig(overrides);
  const port = Number(gs.port || 7777);
  const host = gs.ip || "127.0.0.1";

  if (await isPortOpen(port, host)) {
    return { ok: true, alreadyRunning: true };
  }

  const autoStart = gs.autoStart !== false;
  if (!autoStart) {
    return {
      ok: false,
      skipped: true,
      reason: "Gameserver auto-start is off. Enable gameserver.autoStart in config or start a host manually on port 7777.",
    };
  }

  const gamePath = resolveGamePath(gs);
  const username = resolveUsername(config);
  const accountId = resolveAccountId(config, username);
  const build = parseBuild(gamePath);

  if (build >= 23) {
    return { ok: false, reason: "Chapter 4+ builds need a separate gameserver host (not supported yet)." };
  }

  if (!gamePath || !fs.existsSync(gamePath)) {
    return {
      ok: false,
      reason:
        "No Fortnite build set for gameserver. Select your build in Velocity Settings so VELOCITY_GAME_PATH is set.",
    };
  }

  const dllPath = resolveDllPath(gs);
  const needsDll = build < 15;
  if (needsDll && (!dllPath || !fs.existsSync(dllPath))) {
    return {
      ok: false,
      needsDll: true,
      reason:
        "Chapter 1 gameserver needs Project Reboot (reboot.dll). Install Reboot Launcher or set gameserver.dllPath in config.",
    };
  }

  if (starting) {
    const ready = await waitForPort(port, host, 120000);
    return ready ? { ok: true, alreadyRunning: true } : { ok: false, reason: "Gameserver start already in progress and timed out." };
  }

  starting = true;
  stopGameserver();

  const win64 = path.dirname(gamePath);
  let exchangeCode = "";
  if (build >= 8.51) exchangeCode = await fetchExchangeCode(username);

  const args = buildGameserverArgs({
    config,
    gs,
    build,
    username,
    accountId,
    playlist: overrides.playlist,
    port,
    useExchangeCode: build >= 8.51,
    exchangeCode,
  });

  try {
    appendLog(`\n[${new Date().toISOString()}] Starting gameserver build=${build} port=${port}`);
    appendLog(args.join(" "));

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
      log.matchmaker(injected ? `Injected Reboot into gameserver PID ${pid}` : `Reboot inject failed for PID ${pid}`);

      if (needsDll) {
        await new Promise((r) => setTimeout(r, 8000));
        for (let i = 0; i < 5; i++) {
          const keyed = await pressRebootHostKeys(pid);
          appendLog(`host keys attempt ${i + 1}: ${keyed}`);
          if (await isPortOpen(port, host)) break;
          await new Promise((r) => setTimeout(r, 6000));
        }
      }
    }

    const ready = await waitForPort(port, host, 120000);
    starting = false;

    if (ready) {
      log.matchmaker(`Gameserver listening on ${host}:${port}`);
      appendLog(`READY on ${host}:${port}`);
      return { ok: true, started: true, pid };
    }

    appendLog("NOT READY — port 7777 never opened");
    return {
      ok: false,
      reason: needsDll
        ? "Gameserver did not open port 7777. In the gameserver window press F3 to host, or check Gameserver.log."
        : "Gameserver did not open port 7777. Check Gameserver.log in %AppData%\\velocity-app.",
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
    gamePath: resolveGamePath(gs) || null,
    dllPath: dllPath || null,
    dllFound: Boolean(dllPath && fs.existsSync(dllPath)),
    autoStart: gs.autoStart !== false,
  };
}

module.exports = { ensureGameserver, stopGameserver, isPortOpen, waitForPort, gameserverStatus };
