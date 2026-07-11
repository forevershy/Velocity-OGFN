/**
 * Inject bundled season icons + latest renderer into packaged app.asar archives.
 * Use after code changes when you don't want a full electron-builder rebuild.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

const launcherRoot = path.join(__dirname, "..");
const asarCli = path.join(launcherRoot, "node_modules", "@electron", "asar", "bin", "asar.js");

function runAsar(args) {
  execFileSync(process.execPath, [asarCli, ...args], { stdio: "inherit" });
}
const rendererSrc = path.join(launcherRoot, "renderer");

const asarTargets = [
  path.join(launcherRoot, "dist", "win-unpacked", "resources", "app.asar"),
  path.join(process.env.USERPROFILE || "", "VelocityTestInstall", "resources", "app.asar"),
];

const rootFiles = ["main.js", "preload.js", "discord-presence.js", "net-setup.js", "launch-game.js", "launch-profiles.js", "auth-launch.js", "libcurl-ssl.js", "gameserver-host.js", "dll-inject.js", "spawn-with-parent.js", "process-utils.js", "eac-eos-shim.js", "custom-paks.js"];

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dest, name);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function patchAsar(asarPath) {
  if (!fs.existsSync(asarPath)) {
    console.warn("Skip (not found):", asarPath);
    return false;
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "velocity-asar-"));
  console.log("Extracting", asarPath);
  runAsar(["extract", asarPath, tmp]);

  copyDir(rendererSrc, path.join(tmp, "renderer"));
  for (const file of rootFiles) {
    fs.copyFileSync(path.join(launcherRoot, file), path.join(tmp, file));
  }

  const backup = `${asarPath}.bak`;
  if (!fs.existsSync(backup)) fs.copyFileSync(asarPath, backup);

  console.log("Repacking", asarPath);
  runAsar(["pack", tmp, asarPath]);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("Patched:", asarPath);
  return true;
}

let patched = 0;
for (const target of asarTargets) {
  if (patchAsar(target)) patched += 1;
}

if (patched === 0) {
  console.error("No app.asar archives were patched.");
  process.exit(1);
}

console.log(`Patched ${patched} app.asar archive(s).`);
