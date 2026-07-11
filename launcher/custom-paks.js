const fs = require("fs");
const path = require("path");

const CUSTOM_PAK_DIR = path.join(require("electron").app.getPath("userData"), "custom-paks");

function ensurePakDir() {
  fs.mkdirSync(CUSTOM_PAK_DIR, { recursive: true });
  return CUSTOM_PAK_DIR;
}

function resolveBuildPaksDir(exePath) {
  const win64 = path.dirname(String(exePath || ""));
  const gameRoot = path.dirname(path.dirname(path.dirname(win64)));
  return path.join(gameRoot, "FortniteGame", "Content", "Paks");
}

function installCustomPaks(exePath) {
  ensurePakDir();
  if (!exePath || !fs.existsSync(exePath)) return { ok: false, installed: 0 };

  const dest = resolveBuildPaksDir(exePath);
  fs.mkdirSync(dest, { recursive: true });

  const files = fs.readdirSync(CUSTOM_PAK_DIR).filter((f) => f.toLowerCase().endsWith(".pak"));
  const installed = [];

  for (const name of files) {
    const targetName = name.toLowerCase().startsWith("ogfn_") ? name : `OGFN_${name}`;
    fs.copyFileSync(path.join(CUSTOM_PAK_DIR, name), path.join(dest, targetName));
    installed.push(targetName);
  }

  return { ok: true, installed, dest, pakDir: CUSTOM_PAK_DIR };
}

function listCustomPaks() {
  ensurePakDir();
  return fs.readdirSync(CUSTOM_PAK_DIR).filter((f) => f.toLowerCase().endsWith(".pak"));
}

module.exports = { CUSTOM_PAK_DIR, ensurePakDir, installCustomPaks, listCustomPaks, resolveBuildPaksDir };
