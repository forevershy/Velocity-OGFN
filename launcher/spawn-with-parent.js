const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const HELPER_NAME = "velocity-spawn-with-parent-v2.exe";

const CS_SOURCE = String.raw`using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

public class VelocitySpawnWithParent {
  const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
  const int PROC_THREAD_ATTRIBUTE_PARENT_PROCESS = 0x00020000;
  const uint PROCESS_CREATE_PROCESS = 0x0080;
  const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

  [StructLayout(LayoutKind.Sequential)]
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
  struct STARTUPINFOEX {
    public STARTUPINFO StartupInfo;
    public IntPtr lpAttributeList;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct PROCESS_INFORMATION {
    public IntPtr hProcess, hThread;
    public int dwProcessId, dwThreadId;
  }

  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  static extern bool CreateProcessW(
    string lpApplicationName,
    StringBuilder lpCommandLine,
    IntPtr lpProcessAttributes,
    IntPtr lpThreadAttributes,
    bool bInheritHandles,
    uint dwCreationFlags,
    IntPtr lpEnvironment,
    string lpCurrentDirectory,
    ref STARTUPINFOEX lpStartupInfo,
    out PROCESS_INFORMATION lpProcessInformation);

  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool InitializeProcThreadAttributeList(IntPtr lpAttributeList, int dwAttributeCount, int dwFlags, ref IntPtr lpSize);

  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool UpdateProcThreadAttribute(
    IntPtr lpAttributeList,
    uint dwFlags,
    IntPtr Attribute,
    IntPtr lpValue,
    IntPtr cbSize,
    IntPtr lpPreviousValue,
    IntPtr lpReturnSize);

  [DllImport("kernel32.dll", SetLastError=true)]
  static extern void DeleteProcThreadAttributeList(IntPtr lpAttributeList);

  [DllImport("kernel32.dll", SetLastError=true)]
  static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, int dwProcessId);

  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool CloseHandle(IntPtr hObject);

  static string Quote(string s) {
    if (string.IsNullOrEmpty(s)) return "\"\"";
    if (s.IndexOfAny(new char[]{' ', '\t', '"', '='}) < 0) return s;
    return "\"" + s.Replace("\"", "\\\"") + "\"";
  }

  public static int Main(string[] args) {
    if (args.Length < 3) return 2;
    int parentPid;
    if (!int.TryParse(args[0], out parentPid)) return 3;
    string exe = args[1];
    string cwd = args[2];
    if (!File.Exists(exe)) return 4;

    var cmdParts = new System.Collections.Generic.List<string>();
    cmdParts.Add(Quote(exe));
    for (int i = 3; i < args.Length; i++) cmdParts.Add(Quote(args[i]));
    var cmdLine = new StringBuilder(string.Join(" ", cmdParts));

    IntPtr size = IntPtr.Zero;
    InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
    IntPtr attrList = Marshal.AllocHGlobal(size.ToInt32());
    if (!InitializeProcThreadAttributeList(attrList, 1, 0, ref size)) return 5;

    IntPtr parentHandle = OpenProcess(PROCESS_CREATE_PROCESS | PROCESS_QUERY_LIMITED_INFORMATION, false, parentPid);
    if (parentHandle == IntPtr.Zero) {
      Console.Error.WriteLine("OpenProcess failed: " + new Win32Exception(Marshal.GetLastWin32Error()).Message);
      return 6;
    }

    IntPtr lpValue = Marshal.AllocHGlobal(IntPtr.Size);
    Marshal.WriteIntPtr(lpValue, parentHandle);
    if (!UpdateProcThreadAttribute(attrList, 0, (IntPtr)PROC_THREAD_ATTRIBUTE_PARENT_PROCESS, lpValue, (IntPtr)IntPtr.Size, IntPtr.Zero, IntPtr.Zero)) {
      CloseHandle(parentHandle);
      return 7;
    }

    var si = new STARTUPINFOEX();
    si.StartupInfo.cb = Marshal.SizeOf(typeof(STARTUPINFOEX));
    si.lpAttributeList = attrList;

    PROCESS_INFORMATION pi;
    bool ok = CreateProcessW(exe, cmdLine, IntPtr.Zero, IntPtr.Zero, false, EXTENDED_STARTUPINFO_PRESENT, IntPtr.Zero, cwd, ref si, out pi);

    DeleteProcThreadAttributeList(attrList);
    Marshal.FreeHGlobal(lpValue);
    CloseHandle(parentHandle);
    if (!ok) {
      Console.Error.WriteLine("CreateProcess failed: " + new Win32Exception(Marshal.GetLastWin32Error()).Message);
      return 8;
    }

    if (pi.hProcess != IntPtr.Zero) CloseHandle(pi.hProcess);
    if (pi.hThread != IntPtr.Zero) CloseHandle(pi.hThread);
    Console.WriteLine(pi.dwProcessId);
    return 0;
  }
}
`;

const CSC_PATHS = [
  "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe",
  "C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe",
];

function ensureSpawnHelper(cacheDir) {
  const helperPath = path.join(cacheDir, HELPER_NAME);
  if (fs.existsSync(helperPath) && fs.statSync(helperPath).size > 4096) {
    return helperPath;
  }

  fs.mkdirSync(cacheDir, { recursive: true });
  const csPath = path.join(cacheDir, "velocity-spawn-with-parent.cs");
  fs.writeFileSync(csPath, CS_SOURCE, "utf8");

  const csc = CSC_PATHS.find((p) => fs.existsSync(p));
  if (!csc) {
    throw new Error("Could not find csc.exe to build the spawn helper.");
  }

  execFileSync(csc, ["/nologo", `/out:${helperPath}`, csPath], { windowsHide: true });
  if (!fs.existsSync(helperPath)) {
    throw new Error("Could not build the process spawn helper.");
  }
  return helperPath;
}

function spawnWithParent(cacheDir, parentPid, exePath, cwd, launchArgs = []) {
  const helperPath = ensureSpawnHelper(cacheDir);
  const args = [String(parentPid), exePath, cwd, ...launchArgs];
  return new Promise((resolve, reject) => {
    const child = spawn(helperPath, args, { windowsHide: true, cwd });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => (stdout += d));
    child.stderr?.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || "spawn helper failed (" + code + ")"));
        return;
      }
      const pid = parseInt(stdout.trim(), 10);
      resolve(Number.isFinite(pid) ? pid : 0);
    });
  });
}

function getProcessPid(imageName) {
  const { exec } = require("child_process");
  return new Promise((resolve) => {
    exec('tasklist /FI "IMAGENAME eq ' + imageName + '" /NH /FO CSV', { windowsHide: true }, (err, out) => {
      if (err || !out) return resolve(0);
      const line = out.split(/\r?\n/).find((l) => l.toLowerCase().includes(imageName.toLowerCase()));
      if (!line) return resolve(0);
      const parts = line.split(",");
      const pid = parseInt(parts[1]?.replace(/"/g, ""), 10);
      resolve(Number.isFinite(pid) ? pid : 0);
    });
  });
}

async function waitForProcessPid(imageName, timeoutMs = 10000) {
  const steps = Math.ceil(timeoutMs / 250);
  for (let i = 0; i < steps; i++) {
    const pid = await getProcessPid(imageName);
    if (pid) return pid;
    await new Promise((r) => setTimeout(r, 250));
  }
  return 0;
}

module.exports = { spawnWithParent, waitForProcessPid, getProcessPid };
