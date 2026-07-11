const fs = require("fs");
const path = require("path");
const { accountIdFromName } = require("../utils/functions");

const BANS_PATH = path.join(__dirname, "..", "data", "bans.json");

function loadBans() {
  try {
    const raw = JSON.parse(fs.readFileSync(BANS_PATH, "utf8"));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function saveBans(list) {
  fs.mkdirSync(path.dirname(BANS_PATH), { recursive: true });
  fs.writeFileSync(BANS_PATH, JSON.stringify(list, null, 2));
}

function normalizeTarget(input) {
  const value = String(input || "").trim();
  if (!value) return { ok: false, reason: "Username or account ID is required." };

  if (/^[a-f0-9]{32}$/i.test(value)) {
    return { ok: true, accountId: value.toLowerCase(), username: null };
  }

  const username = value.replace(/@.*/, "");
  return { ok: true, accountId: accountIdFromName(username), username };
}

function getBanInfo(accountId) {
  const id = String(accountId || "").toLowerCase();
  return loadBans().find((b) => b.accountId === id) || null;
}

function isBanned(accountId) {
  return Boolean(getBanInfo(accountId));
}

function listBans() {
  return loadBans();
}

function banAccount({ accountId, username, reason, bannedBy }) {
  const id = String(accountId || "").toLowerCase();
  if (!id) return { ok: false, reason: "accountId is required." };

  const config = require("../config/config.json");
  const ownerId = config.owner?.accountId?.toLowerCase();
  if (ownerId && id === ownerId) {
    return { ok: false, reason: "Cannot ban the configured server owner." };
  }

  const bans = loadBans();
  const existing = bans.find((b) => b.accountId === id);
  const entry = {
    accountId: id,
    username: username || existing?.username || null,
    reason: String(reason || "Banned by server staff.").trim(),
    bannedBy: bannedBy || "panel",
    bannedAt: new Date().toISOString(),
  };

  if (existing) {
    Object.assign(existing, entry);
  } else {
    bans.push(entry);
  }

  saveBans(bans);
  return { ok: true, ban: entry };
}

function unbanAccount(accountId) {
  const id = String(accountId || "").toLowerCase();
  const bans = loadBans();
  const next = bans.filter((b) => b.accountId !== id);
  if (next.length === bans.length) return { ok: false, reason: "That account is not banned." };
  saveBans(next);
  return { ok: true, accountId: id };
}

function resolveUsername(accountId, sessions) {
  const ban = getBanInfo(accountId);
  if (ban?.username) return ban.username;

  if (sessions) {
    const session = sessions.get(accountId);
    if (session?.displayName) return session.displayName;
  }

  return null;
}

module.exports = {
  loadBans,
  listBans,
  getBanInfo,
  isBanned,
  banAccount,
  unbanAccount,
  normalizeTarget,
  resolveUsername,
};
