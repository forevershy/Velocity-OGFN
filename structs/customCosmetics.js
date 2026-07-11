const fs = require("fs");
const path = require("path");

const CUSTOM_PATH = path.join(__dirname, "..", "data", "custom-cosmetics.json");

function loadCustomCosmetics() {
  try {
    const raw = JSON.parse(fs.readFileSync(CUSTOM_PATH, "utf8"));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function saveCustomCosmetics(list) {
  fs.mkdirSync(path.dirname(CUSTOM_PATH), { recursive: true });
  fs.writeFileSync(CUSTOM_PATH, JSON.stringify(list, null, 2));
}

function normalizeEntry(body) {
  const name = String(body.name || "").trim();
  const templateId = String(body.templateId || "").trim();
  const type = String(body.type || "skin").trim().toLowerCase();
  const rarity = String(body.rarity || "legendary").trim().toLowerCase();
  const note = String(body.note || "").trim();

  if (!name || !templateId || !templateId.includes(":")) {
    return { ok: false, reason: "name and templateId (with :) are required." };
  }

  return {
    ok: true,
    entry: {
      name,
      templateId,
      type,
      rarity,
      custom: true,
      note,
      ...(body.grantTemplateId ? { grantTemplateId: String(body.grantTemplateId).trim() } : {}),
      ...(body.pakFile ? { pakFile: String(body.pakFile).trim() } : {}),
    },
  };
}

function addCustomCosmetic(body) {
  const normalized = normalizeEntry(body);
  if (!normalized.ok) return normalized;

  const list = loadCustomCosmetics();
  if (list.some((e) => e.templateId.toLowerCase() === normalized.entry.templateId.toLowerCase())) {
    return { ok: false, reason: "That template ID is already registered." };
  }

  list.push(normalized.entry);
  saveCustomCosmetics(list);
  return { ok: true, entry: normalized.entry };
}

function removeCustomCosmetic(templateId) {
  const want = String(templateId || "").trim().toLowerCase();
  if (!want) return { ok: false, reason: "templateId is required." };

  const list = loadCustomCosmetics();
  const next = list.filter((e) => e.templateId.toLowerCase() !== want);
  if (next.length === list.length) return { ok: false, reason: "Custom cosmetic not found." };

  saveCustomCosmetics(next);
  return { ok: true };
}

/** Custom catalog IDs without a .pak resolve to a real in-game template. */
function resolveGrantTemplateId(templateId) {
  const want = String(templateId || "").trim().toLowerCase();
  if (!want) return templateId;

  const entry = loadCustomCosmetics().find((e) => e.templateId.toLowerCase() === want);
  const grant = String(entry?.grantTemplateId || "").trim();
  return grant || templateId;
}

function findCustomCosmetic(templateId) {
  const want = String(templateId || "").trim().toLowerCase();
  if (!want) return null;
  return loadCustomCosmetics().find((e) => e.templateId.toLowerCase() === want) || null;
}

module.exports = {
  loadCustomCosmetics,
  saveCustomCosmetics,
  addCustomCosmetic,
  removeCustomCosmetic,
  resolveGrantTemplateId,
  findCustomCosmetic,
};
