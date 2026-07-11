/**
 * Copies the Velocity backend into launcher/backend-bundle for electron-builder.
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const OUT = path.join(__dirname, "..", "backend-bundle");

function rimraf(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function copyDir(src, dest, skip = new Set()) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (skip.has(name)) continue;
    const s = path.join(src, name);
    const d = path.join(dest, name);
    if (fs.statSync(s).isDirectory()) copyDir(s, d, skip);
    else fs.copyFileSync(s, d);
  }
}

rimraf(OUT);
fs.mkdirSync(OUT, { recursive: true });

const items = [
  "index.js",
  "package.json",
  "package-lock.json",
  "routes",
  "structs",
  "utils",
  "xmpp",
  "ws",
  "matchmaker",
  "config",
  "panel",
  "data",
];
for (const item of items) {
  const src = path.join(ROOT, item);
  const dest = path.join(OUT, item);
  if (!fs.existsSync(src)) {
    console.warn("skip missing:", item);
    continue;
  }
  if (fs.statSync(src).isDirectory()) copyDir(src, dest, new Set(["shop-cache.json"]));
  else fs.copyFileSync(src, dest);
}

const systemSrc = path.join(ROOT, "cloudstorage", "system");
const systemDest = path.join(OUT, "cloudstorage", "system");
if (fs.existsSync(systemSrc)) copyDir(systemSrc, systemDest);

fs.mkdirSync(path.join(OUT, "cloudstorage", "user"), { recursive: true });

console.log("Installing backend production dependencies...");
execSync("npm install --omit=dev", { cwd: OUT, stdio: "inherit" });
console.log("Backend bundle ready at", OUT);
