const fs = require("fs");
const path = require("path");

const PAK_DIR =
  process.env.VELOCITY_CUSTOM_PAK_DIR ||
  (process.env.VELOCITY_USER_DATA
    ? path.join(process.env.VELOCITY_USER_DATA, "custom-paks")
    : path.join(__dirname, "..", "custom-paks"));
const REGISTRY_PATH = path.join(__dirname, "..", "data", "custom-paks.json");

function ensurePakDir() {
  fs.mkdirSync(PAK_DIR, { recursive: true });
  return PAK_DIR;
}

function loadPakRegistry() {
  try {
    const raw = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function savePakRegistry(list) {
  fs.mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true });
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(list, null, 2));
}

function listPakFiles() {
  ensurePakDir();
  return fs
    .readdirSync(PAK_DIR)
    .filter((name) => name.toLowerCase().endsWith(".pak"))
    .map((name) => {
      const full = path.join(PAK_DIR, name);
      const stat = fs.statSync(full);
      return {
        name,
        size: stat.size,
        updated: stat.mtime.toISOString(),
        path: full,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function resolveBuildPaksDir(exePath) {
  const win64 = path.dirname(String(exePath || ""));
  const gameRoot = path.dirname(path.dirname(path.dirname(win64)));
  return path.join(gameRoot, "FortniteGame", "Content", "Paks");
}

function installPaksToBuild(exePath) {
  if (!exePath || !fs.existsSync(exePath)) {
    return { ok: false, reason: "Fortnite executable path is missing or invalid." };
  }

  const dest = resolveBuildPaksDir(exePath);
  fs.mkdirSync(dest, { recursive: true });

  const files = listPakFiles();
  if (!files.length) {
    return { ok: false, reason: `No .pak files found in ${PAK_DIR}` };
  }

  const installed = [];
  for (const file of files) {
    const targetName = file.name.toLowerCase().startsWith("ogfn_") ? file.name : `OGFN_${file.name}`;
    const target = path.join(dest, targetName);
    fs.copyFileSync(file.path, target);
    installed.push({ name: file.name, target: targetName });
  }

  return { ok: true, installed, dest, pakDir: PAK_DIR };
}

function registerPakEntry(body = {}) {
  const name = String(body.name || "").trim();
  const pakFile = String(body.pakFile || body.filename || "").trim();
  const templateId = String(body.templateId || "").trim();
  const note = String(body.note || "").trim();

  if (!name || !pakFile) {
    return { ok: false, reason: "name and pakFile are required." };
  }

  ensurePakDir();
  const existsOnDisk = fs.existsSync(path.join(PAK_DIR, pakFile));
  if (!existsOnDisk) {
    return { ok: false, reason: `Place ${pakFile} in ${PAK_DIR} first.` };
  }

  const list = loadPakRegistry();
  const idx = list.findIndex((e) => e.pakFile.toLowerCase() === pakFile.toLowerCase());
  const entry = {
    name,
    pakFile,
    templateId,
    note,
    custom: true,
    updated: new Date().toISOString(),
  };

  if (idx >= 0) list[idx] = { ...list[idx], ...entry };
  else list.push(entry);
  savePakRegistry(list);

  if (templateId) {
    try {
      const { addCustomCosmetic } = require("./customCosmetics");
      addCustomCosmetic({
        name,
        templateId,
        type: "skin",
        rarity: "owner",
        note: note || `Custom pak: ${pakFile}`,
        pakFile,
      });
    } catch {
      /* cosmetic may already exist */
    }
  }

  return { ok: true, entry };
}

module.exports = {
  PAK_DIR,
  ensurePakDir,
  loadPakRegistry,
  listPakFiles,
  resolveBuildPaksDir,
  installPaksToBuild,
  registerPakEntry,
};
