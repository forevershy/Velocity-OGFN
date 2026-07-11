// Builds FortniteClient-Win64-Shipping_EAC_EOS.exe wrapper for stripped Ch4+ builds.
// FortniteLauncher spawns this with -launch -App=Fortnite; real EAC EOS strips those
// and starts shipping. Our wrapper does the same when the build omits the real binary.
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const SHIM_NAME = "velocity-eac-eos-shim.exe";
const TARGET_NAME = "FortniteClient-Win64-Shipping_EAC_EOS.exe";
const SHIPPING_NAME = "FortniteClient-Win64-Shipping.exe";

const CS_SOURCE = String.raw`using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;

public class VelocityEacEosShim {
  static string Quote(string s) {
    if (string.IsNullOrEmpty(s)) return "\"\"";
    if (s.IndexOfAny(new char[]{' ', '\t', '"', '='}) < 0) return s;
    return "\"" + s.Replace("\"", "\\\"") + "\"";
  }

  public static int Main(string[] args) {
    string dir = AppDomain.CurrentDomain.BaseDirectory;
    string shipping = Path.Combine(dir, "FortniteClient-Win64-Shipping.exe");
    if (!File.Exists(shipping)) return 2;

    var kept = new List<string>();
    bool hasFromFl = false;
    bool hasCaldera = false;

    for (int i = 0; i < args.Length; i++) {
      string a = args[i];
      if (string.Equals(a, "-launch", StringComparison.OrdinalIgnoreCase)) continue;
      if (string.Equals(a, "-App", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length) { i++; continue; }
      if (a.StartsWith("-App=", StringComparison.OrdinalIgnoreCase)) continue;
      if (string.Equals(a, "-nobe", StringComparison.OrdinalIgnoreCase)) continue;
      if (string.Equals(a, "-noeaceos", StringComparison.OrdinalIgnoreCase)) continue;
      if (a.StartsWith("-fromfl=", StringComparison.OrdinalIgnoreCase)) {
        if (a.Equals("-fromfl=be", StringComparison.OrdinalIgnoreCase)) continue;
        hasFromFl = true;
      }
      if (a.StartsWith("-caldera=", StringComparison.OrdinalIgnoreCase)) hasCaldera = true;
      kept.Add(a);
    }

    if (!hasFromFl) kept.Add("-fromfl=eaceos");
    if (!hasCaldera) return 3;

    var cmdParts = new List<string>();
    foreach (var part in kept) cmdParts.Add(Quote(part));
    var cmdLine = string.Join(" ", cmdParts);

    var si = new ProcessStartInfo {
      FileName = shipping,
      Arguments = cmdLine,
      WorkingDirectory = dir,
      UseShellExecute = false,
    };

    using (var child = Process.Start(si)) {
      if (child == null) return 4;
      child.WaitForExit();
      return child.ExitCode;
    }
  }
}
`;

const CSC_PATHS = [
  "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe",
  "C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe",
];

function ensureEacEosWrapper(cacheDir, win64) {
  const target = path.join(win64, TARGET_NAME);
  const shipping = path.join(win64, SHIPPING_NAME);
  if (!fs.existsSync(shipping)) return;

  const helperPath = path.join(cacheDir, SHIM_NAME);
  if (!fs.existsSync(helperPath) || fs.statSync(helperPath).size < 4096) {
    fs.mkdirSync(cacheDir, { recursive: true });
    const csPath = path.join(cacheDir, "velocity-eac-eos-shim.cs");
    fs.writeFileSync(csPath, CS_SOURCE, "utf8");
    const csc = CSC_PATHS.find((p) => fs.existsSync(p));
    if (!csc) throw new Error("Could not find csc.exe to build the EAC EOS wrapper.");
    execFileSync(csc, ["/nologo", `/out:${helperPath}`, csPath], { windowsHide: true });
  }

  const backup = target + ".velocity-off";
  if (fs.existsSync(target)) {
    try {
      const sameSize = fs.statSync(target).size === fs.statSync(helperPath).size;
      if (sameSize) return;
      if (!fs.existsSync(backup)) fs.copyFileSync(target, backup);
    } catch {
      /* replace below */
    }
  }

  fs.copyFileSync(helperPath, target);
}

module.exports = { ensureEacEosWrapper, TARGET_NAME };
