/**
 * Refresh backend-bundle from source and sync it into packaged installs.
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const launcherRoot = path.join(__dirname, "..");
const bundleDir = path.join(launcherRoot, "backend-bundle");

const installTargets = [
  path.join(launcherRoot, "dist", "win-unpacked", "resources", "backend"),
  path.join(process.env.USERPROFILE || "", "VelocityTestInstall", "resources", "backend"),
];

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (name === "node_modules") continue;
    const s = path.join(src, name);
    const d = path.join(dest, name);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function syncBackend(target) {
  if (!fs.existsSync(target)) {
    console.warn("Skip (not found):", target);
    return false;
  }
  console.log("Syncing backend ->", target);
  copyDir(bundleDir, target);
  execSync("npm install --omit=dev", { cwd: target, stdio: "inherit" });
  console.log("Done:", target);
  return true;
}

console.log("Preparing backend bundle...");
execSync("node scripts/prepare-backend.js", { cwd: launcherRoot, stdio: "inherit" });

const required = [
  path.join(bundleDir, "structs", "certs.js"),
  path.join(bundleDir, "structs", "epicHosts.js"),
  path.join(bundleDir, "node_modules", "node-forge"),
];
for (const file of required) {
  if (!fs.existsSync(file)) {
    console.error("Missing required backend file:", file);
    process.exit(1);
  }
}

let synced = 0;
for (const target of installTargets) {
  if (syncBackend(target)) synced += 1;
}

if (synced === 0) {
  console.error("No backend installs were synced.");
  process.exit(1);
}

console.log(`Synced backend to ${synced} install(s).`);
