const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");

function dataPath(name) {
  return path.join(DATA_DIR, name);
}

function readJson(name, fallback) {
  try {
    const raw = JSON.parse(fs.readFileSync(dataPath(name), "utf8"));
    return raw ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(name, value) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(dataPath(name), JSON.stringify(value, null, 2));
}

// Discord user ID -> OGFN username
function getDiscordLink(discordUserId) {
  const links = readJson("discord-links.json", {});
  return links[String(discordUserId)] || null;
}

function setDiscordLink(discordUserId, username) {
  const links = readJson("discord-links.json", {});
  links[String(discordUserId)] = String(username).trim();
  writeJson("discord-links.json", links);
  return links[String(discordUserId)];
}

function removeDiscordLink(discordUserId) {
  const links = readJson("discord-links.json", {});
  delete links[String(discordUserId)];
  writeJson("discord-links.json", links);
}

function listCustomMatchCodes() {
  return readJson("custom-match-codes.json", []);
}

function addCustomMatchCode({ code, playlist, region, createdBy }) {
  const normalized = String(code || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (normalized.length < 4 || normalized.length > 16) {
    return { ok: false, reason: "Code must be 4–16 letters/numbers." };
  }

  const list = listCustomMatchCodes();
  if (list.some((e) => e.code === normalized)) {
    return { ok: false, reason: "That match code already exists." };
  }

  const entry = {
    code: normalized,
    playlist: playlist || "Playlist_DefaultSolo",
    region: region || "NAE",
    createdBy: createdBy || "panel",
    createdAt: new Date().toISOString(),
  };
  list.push(entry);
  writeJson("custom-match-codes.json", list);
  return { ok: true, entry };
}

function removeCustomMatchCode(code) {
  const want = String(code || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  const list = listCustomMatchCodes();
  const next = list.filter((e) => e.code !== want);
  if (next.length === list.length) return { ok: false, reason: "Match code not found." };
  writeJson("custom-match-codes.json", next);
  return { ok: true, code: want };
}

function getCustomMatchCode(code) {
  const want = String(code || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return listCustomMatchCodes().find((e) => e.code === want) || null;
}

function listSacCodes() {
  return readJson("sac-codes.json", []);
}

function addSacCode({ code, displayName, createdBy }) {
  const slug = String(code || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (slug.length < 3 || slug.length > 16) {
    return { ok: false, reason: "SAC code must be 3–16 letters/numbers." };
  }

  const list = listSacCodes();
  if (list.some((e) => e.code === slug)) {
    return { ok: false, reason: "That SAC code already exists." };
  }

  const entry = {
    code: slug,
    displayName: displayName || slug,
    createdBy: createdBy || "panel",
    createdAt: new Date().toISOString(),
  };
  list.push(entry);
  writeJson("sac-codes.json", list);
  return { ok: true, entry };
}

function removeSacCode(code) {
  const slug = String(code || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const list = listSacCodes();
  const next = list.filter((e) => e.code !== slug);
  if (next.length === list.length) return { ok: false, reason: "SAC code not found." };
  writeJson("sac-codes.json", next);
  return { ok: true, code: slug };
}

function listAppeals() {
  return readJson("appeals.json", []);
}

function submitAppeal({ accountId, username, discordUserId, reason }) {
  const appeals = listAppeals();
  const pending = appeals.find((a) => a.accountId === accountId && a.status === "pending");
  if (pending) return { ok: false, reason: "You already have a pending appeal." };

  const entry = {
    accountId,
    username,
    discordUserId: discordUserId || null,
    reason: String(reason || "Appeal submitted via Discord.").trim(),
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  appeals.push(entry);
  writeJson("appeals.json", appeals);
  return { ok: true, appeal: entry };
}

function claimDailyVbucks(accountId, amount = 250) {
  const claims = readJson("daily-claims.json", {});
  const today = new Date().toISOString().slice(0, 10);
  const last = claims[accountId];
  if (last === today) {
    return { ok: false, reason: "You already claimed your daily V-Bucks today. Come back tomorrow!" };
  }
  claims[accountId] = today;
  writeJson("daily-claims.json", claims);
  return { ok: true, amount, claimDate: today };
}

module.exports = {
  getDiscordLink,
  setDiscordLink,
  removeDiscordLink,
  listCustomMatchCodes,
  addCustomMatchCode,
  removeCustomMatchCode,
  getCustomMatchCode,
  listSacCodes,
  addSacCode,
  removeSacCode,
  listAppeals,
  submitAppeal,
  claimDailyVbucks,
};
