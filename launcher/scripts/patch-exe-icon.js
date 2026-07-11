const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");

const launcherRoot = path.join(__dirname, "..");
const iconPath = path.join(launcherRoot, "build", "icon.ico");
const version = require(path.join(launcherRoot, "package.json")).version;
const rceditExe = path.join(
  launcherRoot,
  "node_modules",
  "rcedit",
  "bin",
  process.arch === "x64" || process.arch === "arm64" ? "rcedit-x64.exe" : "rcedit.exe"
);

const defaultTargets = [
  path.join(launcherRoot, "dist", "win-unpacked", "Velocity.exe"),
  path.join(process.env.USERPROFILE || "", "VelocityTestInstall", "Velocity.exe"),
];

function patchExe(exePath) {
  const resolved = path.resolve(exePath);
  if (!fs.existsSync(resolved)) {
    console.warn("Skip (not found):", resolved);
    return false;
  }
  if (!fs.existsSync(iconPath)) {
    throw new Error(`Missing icon: ${iconPath}. Run npm run make-ico first.`);
  }
  if (!fs.existsSync(rceditExe)) {
    throw new Error(`Missing rcedit: ${rceditExe}`);
  }

  const args = [
    resolved,
    "--set-version-string",
    "FileDescription",
    "Velocity",
    "--set-version-string",
    "ProductName",
    "Velocity",
    "--set-version-string",
    "LegalCopyright",
    "Velocity",
    "--set-file-version",
    version,
    "--set-product-version",
    version,
    "--set-icon",
    iconPath,
  ];

  console.log("Patching icon:", resolved);
  const result = spawnSync(rceditExe, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.warn(`Skip icon patch (rcedit exit ${result.status}): ${resolved}`);
    return false;
  }
  console.log("Done:", resolved);
  return true;
}

function main() {
  const cliTargets = process.argv.slice(2);
  const targets = cliTargets.length ? cliTargets : defaultTargets;
  let patched = 0;

  for (const target of targets) {
    if (patchExe(target)) patched += 1;
  }

  if (patched === 0) {
    console.error("No executables were patched.");
    process.exit(1);
  }
}

main();
