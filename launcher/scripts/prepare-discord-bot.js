/**
 * Copies the Discord bot into launcher/discord-bot-bundle for electron-builder.
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..", "discord-bot");
const OUT = path.join(__dirname, "..", "discord-bot-bundle");

function rimraf(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function copyDir(src, dest, { skipNodeModules = false } = {}) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (skipNodeModules && name === "node_modules") continue;
    const s = path.join(src, name);
    const d = path.join(dest, name);
    if (fs.statSync(s).isDirectory()) copyDir(s, d, { skipNodeModules });
    else fs.copyFileSync(s, d);
  }
}

if (!fs.existsSync(path.join(ROOT, "index.js"))) {
  console.warn("Discord bot source not found — skipping bundle.");
  process.exit(0);
}

rimraf(OUT);
copyDir(ROOT, OUT, { skipNodeModules: true });

console.log("Installing Discord bot production dependencies...");
execSync("npm install --omit=dev", { cwd: OUT, stdio: "inherit" });
console.log("Discord bot bundle ready at", OUT);

const installTargets = [
  path.join(__dirname, "..", "dist", "win-unpacked", "resources", "discord-bot"),
  path.join(process.env.USERPROFILE || "", "VelocityTestInstall", "resources", "discord-bot"),
];

for (const target of installTargets) {
  const parent = path.dirname(target);
  if (!fs.existsSync(parent)) continue;
  const destCfg = path.join(target, "config.json");
  const savedCfg = fs.existsSync(destCfg) ? fs.readFileSync(destCfg) : null;
  console.log("Syncing discord-bot ->", target);
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
  copyDir(OUT, target);
  const localCfg = path.join(ROOT, "config.json");
  if (savedCfg) fs.writeFileSync(destCfg, savedCfg);
  else if (fs.existsSync(localCfg)) fs.copyFileSync(localCfg, destCfg);
}
