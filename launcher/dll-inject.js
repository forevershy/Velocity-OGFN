const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

function cacheDir() {
  return path.join(
    process.env.VELOCITY_USER_DATA || path.join(process.env.APPDATA || "", "velocity-app"),
    "cache"
  );
}

function injectorPath() {
  return path.join(cacheDir(), "velocity-inject.exe");
}

function launcherPath() {
  return path.join(cacheDir(), "velocity-gs-launch-v2.exe");
}

async function ensureInjector() {
  const out = injectorPath();
  if (fs.existsSync(out) && fs.statSync(out).size > 2048) return out;

  fs.mkdirSync(cacheDir(), { recursive: true });
  const safeOut = out.replace(/'/g, "''");
  const script = `
$out = '${safeOut}'
try {
  if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force }
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class VelocityInject {
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, int dwProcessId);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern IntPtr VirtualAllocEx(IntPtr hProcess, IntPtr lpAddress, uint dwSize, uint flAllocationType, uint flProtect);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool WriteProcessMemory(IntPtr hProcess, IntPtr lpBaseAddress, byte[] lpBuffer, uint nSize, out UIntPtr lpNumberOfBytesWritten);
  [DllImport("kernel32.dll", CharSet=CharSet.Ansi, SetLastError=true)]
  static extern IntPtr GetProcAddress(IntPtr hModule, string procName);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern IntPtr GetModuleHandle(string lpModuleName);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern IntPtr CreateRemoteThread(IntPtr hProcess, IntPtr lpThreadAttributes, uint dwStackSize, IntPtr lpStartAddress, IntPtr lpParameter, uint dwCreationFlags, out IntPtr lpThreadId);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool CloseHandle(IntPtr hObject);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);

  const uint PROCESS_ALL_ACCESS = 0x1F0FFF;
  const uint MEM_COMMIT = 0x1000;
  const uint MEM_RESERVE = 0x2000;
  const uint PAGE_READWRITE = 0x04;

  public static int Main(string[] args) {
    if (args.Length < 2) return 2;
    int pid;
    if (!int.TryParse(args[0], out pid) || pid <= 0) return 3;
    string dll = args[1];
    if (!System.IO.File.Exists(dll)) return 4;

    IntPtr hProcess = OpenProcess(PROCESS_ALL_ACCESS, false, pid);
    if (hProcess == IntPtr.Zero) return 5;

    byte[] bytes = Encoding.Unicode.GetBytes(dll + "\\0");
    IntPtr remote = VirtualAllocEx(hProcess, IntPtr.Zero, (uint)bytes.Length, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
    if (remote == IntPtr.Zero) { CloseHandle(hProcess); return 6; }

    UIntPtr written;
    if (!WriteProcessMemory(hProcess, remote, bytes, (uint)bytes.Length, out written)) {
      CloseHandle(hProcess);
      return 7;
    }

    IntPtr loadLib = GetProcAddress(GetModuleHandle("kernel32.dll"), "LoadLibraryW");
    if (loadLib == IntPtr.Zero) { CloseHandle(hProcess); return 8; }

    IntPtr thread;
    IntPtr hThread = CreateRemoteThread(hProcess, IntPtr.Zero, 0, loadLib, remote, 0, out thread);
    if (hThread == IntPtr.Zero) { CloseHandle(hProcess); return 9; }

    WaitForSingleObject(hThread, 15000);
    CloseHandle(hThread);
    CloseHandle(hProcess);
    return 0;
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
      if (code === 0 && fs.existsSync(out)) resolve(out);
      else reject(new Error("Could not build DLL injector."));
    });
    child.on("error", reject);
  });
}

async function ensureSuspendedLauncher() {
  const out = launcherPath();
  if (fs.existsSync(out) && fs.statSync(out).size > 2048) return out;

  fs.mkdirSync(cacheDir(), { recursive: true });
  const safeOut = out.replace(/'/g, "''");
  const script = `
$out = '${safeOut}'
try {
  if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force }
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class VelocityGsLaunch {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  struct STARTUPINFO {
    public int cb;
    public string lpReserved;
    public string lpDesktop;
    public string lpTitle;
    public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
    public short wShowWindow, cbReserved2;
    public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct PROCESS_INFORMATION {
    public IntPtr hProcess;
    public IntPtr hThread;
    public int dwProcessId;
    public int dwThreadId;
  }
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  static extern bool CreateProcess(string lpApplicationName, string lpCommandLine, IntPtr lpProcessAttributes, IntPtr lpThreadAttributes, bool bInheritHandles, uint dwCreationFlags, IntPtr lpEnvironment, string lpCurrentDirectory, ref STARTUPINFO lpStartupInfo, out PROCESS_INFORMATION lpProcessInformation);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern uint ResumeThread(IntPtr hThread);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool CloseHandle(IntPtr hObject);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, int dwProcessId);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern IntPtr VirtualAllocEx(IntPtr hProcess, IntPtr lpAddress, uint dwSize, uint flAllocationType, uint flProtect);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool WriteProcessMemory(IntPtr hProcess, IntPtr lpBaseAddress, byte[] lpBuffer, uint nSize, out UIntPtr lpNumberOfBytesWritten);
  [DllImport("kernel32.dll", CharSet=CharSet.Ansi, SetLastError=true)]
  static extern IntPtr GetProcAddress(IntPtr hModule, string procName);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern IntPtr GetModuleHandle(string lpModuleName);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern IntPtr CreateRemoteThread(IntPtr hProcess, IntPtr lpThreadAttributes, uint dwStackSize, IntPtr lpStartAddress, IntPtr lpParameter, uint dwCreationFlags, out IntPtr lpThreadId);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);

  const uint CREATE_SUSPENDED = 0x00000004;
  const uint CREATE_NO_WINDOW = 0x08000000;
  const uint PROCESS_ALL_ACCESS = 0x1F0FFF;
  const uint MEM_COMMIT = 0x1000;
  const uint MEM_RESERVE = 0x2000;
  const uint PAGE_READWRITE = 0x04;

  static bool Inject(IntPtr hProcess, string dll) {
    byte[] bytes = Encoding.Unicode.GetBytes(dll + "\\0");
    IntPtr remote = VirtualAllocEx(hProcess, IntPtr.Zero, (uint)bytes.Length, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
    if (remote == IntPtr.Zero) return false;
    UIntPtr written;
    if (!WriteProcessMemory(hProcess, remote, bytes, (uint)bytes.Length, out written)) return false;
    IntPtr loadLib = GetProcAddress(GetModuleHandle("kernel32.dll"), "LoadLibraryW");
    if (loadLib == IntPtr.Zero) return false;
    IntPtr tid;
    IntPtr hThread = CreateRemoteThread(hProcess, IntPtr.Zero, 0, loadLib, remote, 0, out tid);
    if (hThread == IntPtr.Zero) return false;
    WaitForSingleObject(hThread, 15000);
    CloseHandle(hThread);
    return true;
  }

  public static int Main(string[] args) {
    if (args.Length < 3) {
      Console.Error.WriteLine("usage: exe cwd dll [--visible] [gameArgs...]");
      return 2;
    }
    string exe = args[0];
    string cwd = args[1];
    string dll = args[2];
    if (!System.IO.File.Exists(exe) || !System.IO.File.Exists(dll)) return 3;

    int argStart = 3;
    uint flags = CREATE_SUSPENDED | CREATE_NO_WINDOW;
    short showWindow = 0;

    if (args.Length > 3 && args[3] == "--visible") {
      flags = CREATE_SUSPENDED;
      showWindow = 9;
      argStart = 4;
    }

    StringBuilder cmd = new StringBuilder();
    cmd.Append('"').Append(exe).Append('"');
    for (int i = argStart; i < args.Length; i++) {
      cmd.Append(' ');
      if (args[i].IndexOf(' ') >= 0) cmd.Append('"').Append(args[i]).Append('"');
      else cmd.Append(args[i]);
    }

    STARTUPINFO si = new STARTUPINFO();
    si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
    si.wShowWindow = showWindow;
    if (showWindow != 0) si.dwFlags = 0x00000001;
    PROCESS_INFORMATION pi;
    if (!CreateProcess(null, cmd.ToString(), IntPtr.Zero, IntPtr.Zero, false, flags, IntPtr.Zero, cwd, ref si, out pi)) {
      Console.Error.WriteLine("CreateProcess failed " + Marshal.GetLastWin32Error());
      return 4;
    }

    bool ok = Inject(pi.hProcess, System.IO.Path.GetFullPath(dll));
    ResumeThread(pi.hThread);
    Console.WriteLine(pi.dwProcessId);
    CloseHandle(pi.hThread);
    CloseHandle(pi.hProcess);
    return ok ? 0 : 5;
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
      if (code === 0 && fs.existsSync(out)) resolve(out);
      else reject(new Error("Could not build suspended gameserver launcher."));
    });
    child.on("error", reject);
  });
}

async function injectDll(pid, dllPath) {
  if (!pid || !dllPath || !fs.existsSync(dllPath)) return false;
  try {
    const injector = await ensureInjector();
    return new Promise((resolve) => {
      const child = spawn(injector, [String(pid), path.resolve(dllPath)], {
        windowsHide: true,
        stdio: "ignore",
      });
      child.on("close", (code) => resolve(code === 0));
      child.on("error", () => resolve(false));
    });
  } catch {
    return false;
  }
}

/**
 * Start exe suspended, inject DLL, resume. Returns { ok, pid }.
 */
async function launchSuspendedWithDll(exePath, args, cwd, dllPath, options = {}) {
  if (!exePath || !dllPath || !fs.existsSync(exePath) || !fs.existsSync(dllPath)) {
    return { ok: false, reason: "exe or dll missing" };
  }
  try {
    const launcher = await ensureSuspendedLauncher();
    const launcherArgs = [path.resolve(exePath), cwd || path.dirname(exePath), path.resolve(dllPath)];
    if (options.showWindow) launcherArgs.push("--visible");
    launcherArgs.push(...args);
    return new Promise((resolve) => {
      const child = spawn(launcher, launcherArgs, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "";
      let err = "";
      child.stdout.on("data", (d) => (out += d.toString()));
      child.stderr.on("data", (d) => (err += d.toString()));
      child.on("close", (code) => {
        const pid = parseInt(String(out).trim().split(/\s+/)[0], 10);
        if (code === 0 && pid > 0) resolve({ ok: true, pid });
        else resolve({ ok: false, reason: err || `launch exit ${code}`, pid: pid || 0 });
      });
      child.on("error", (e) => resolve({ ok: false, reason: e.message }));
    });
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

module.exports = { injectDll, launchSuspendedWithDll };
