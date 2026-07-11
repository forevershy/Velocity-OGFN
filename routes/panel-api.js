const express = require("express");
const app = express.Router();
const fs = require("fs");
const path = require("path");

const config = require("../config/config.json");
const pkg = require("../package.json");
const log = require("../utils/logger");
const {
  listAccounts,
  grantCosmetic,
  grantOwnerSkin,
  repairOwnerCosmetics,
  grantAllCosmetics,
  setVbucks,
  addVbucks,
  setAccountLevel,
  setBattlePassTier,
  ensureAccountProfiles,
  getAccountSummary,
  removeCosmetic,
  deleteAccount,
  changeUsername,
  getArenaLeaderboard,
} = require("../structs/profiles");
const {
  loadCustomCosmetics,
  addCustomCosmetic,
  removeCustomCosmetic,
} = require("../structs/customCosmetics");
const {
  listPakFiles,
  loadPakRegistry,
  installPaksToBuild,
  registerPakEntry,
  PAK_DIR,
} = require("../structs/customPaks");
const { getPresence } = require("../structs/playerPresence");
const { clients, kickClient } = require("../xmpp/xmpp");
const {
  listBans,
  banAccount,
  unbanAccount,
  normalizeTarget,
  getBanInfo,
  isBanned,
  resolveUsername,
} = require("../structs/bans");
const { sessions, revokeAccountSessions } = require("./auth");
const { accountIdFromName } = require("../utils/functions");
const { buildCatalog, findOffer, purchase } = require("../structs/itemShop");
const {
  getDiscordLink,
  setDiscordLink,
  listCustomMatchCodes,
  addCustomMatchCode,
  removeCustomMatchCode,
  listSacCodes,
  addSacCode,
  removeSacCode,
  listAppeals,
  submitAppeal,
  claimDailyVbucks,
} = require("../structs/serverMeta");

const configPath = path.join(__dirname, "..", "config", "config.json");
const systemDir = path.join(__dirname, "..", "cloudstorage", "system");
const certDir = process.env.VELOCITY_CERT_DIR || path.join(__dirname, "..", ".certs");
const shopCosmeticsPath = path.join(__dirname, "..", "data", "shop-cosmetics.json");
const startTime = Date.now();

let shopCatalogCache = null;

function requirePanelAuth(req, res, next) {
  const token = config.panelToken;
  if (!token) return next();
  const header =
    req.headers.authorization?.replace(/^Bearer\s+/i, "").trim() || req.headers["x-velocity-token"];
  if (header === token) return next();
  return res.status(401).json({ ok: false, reason: "Unauthorized — invalid panel token." });
}

function saveConfig() {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

function loadShopCatalog() {
  if (shopCatalogCache) return shopCatalogCache;
  try {
    const raw = JSON.parse(fs.readFileSync(shopCosmeticsPath, "utf8"));
    shopCatalogCache = Array.isArray(raw) ? raw : [];
  } catch {
    shopCatalogCache = [];
  }
  return shopCatalogCache;
}

function searchCosmetics({ search = "", type = "", customOnly = false, limit = 60, offset = 0 } = {}) {
  const q = String(search).trim().toLowerCase();
  const typeFilter = String(type).trim().toLowerCase();
  const lim = Math.max(1, Math.min(200, parseInt(limit, 10) || 60));
  const off = Math.max(0, parseInt(offset, 10) || 0);

  const custom = loadCustomCosmetics().map((e) => ({ ...e, custom: true }));
  const pool = customOnly ? custom : [...custom, ...loadShopCatalog()];

  const filtered = pool.filter((entry) => {
    if (typeFilter && entry.type !== typeFilter) return false;
    if (!q) return true;
    const hay = `${entry.name || ""} ${entry.templateId || ""}`.toLowerCase();
    return hay.includes(q);
  });

  return {
    total: filtered.length,
    items: filtered.slice(off, off + lim),
  };
}

// ---- Status / dashboard ----
app.get("/ogfn-panel/api/status", (req, res) => {
  res.json({
    version: pkg.version,
    online: true,
    uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
    httpPort: config.server.port,
    xmppPort: config.server.xmppPort,
    connectedXmpp: clients.size,
    knownAccounts: listAccounts().length,
    matchmaking: config.bEnableMatchmaking,
    matchmaker: config.matchmaker,
    gameserver: config.gameserver,
    motdEnabled: config.message.enabled,
    owner: config.owner || null,
  });
});

// ---- Owner info ----
app.get("/ogfn-panel/api/owner", (req, res) => {
  const owner = config.owner || {};
  res.json({
    username: owner.username || "",
    accountId: owner.accountId || "",
    cosmeticPoolSize: loadShopCatalog().length + loadCustomCosmetics().length,
  });
});

// ---- Online players (XMPP-connected) ----
app.get("/ogfn-panel/api/players", (req, res) => {
  const online = [];
  for (const [, c] of clients) {
    online.push({
      accountId: c.accountId,
      displayName: c.displayName || c.accountId,
      resource: c.resource,
    });
  }
  res.json({ online, accounts: listAccounts(), owner: config.owner || null });
});

// ---- Player presence (Discord Rich Presence / launcher) ----
app.get("/ogfn-panel/api/presence/:accountId", (req, res) => {
  const p = getPresence(req.params.accountId);
  res.json({ accountId: req.params.accountId, ...p });
});

// ---- CA cert for friends joining this host over LAN ----
app.get("/ogfn-panel/api/ca", (req, res) => {
  const caPath = path.join(certDir, "velocity-ca.crt");
  if (!fs.existsSync(caPath)) return res.status(404).json({ ok: false, reason: "CA not generated yet." });
  res.type("application/x-x509-ca-cert").send(fs.readFileSync(caPath));
});

// ---- MOTD / message ----
app.get("/ogfn-panel/api/motd", (req, res) => res.json(config.message));
app.post("/ogfn-panel/api/motd", requirePanelAuth, (req, res) => {
  const { enabled, text } = req.body || {};
  if (typeof enabled === "boolean") config.message.enabled = enabled;
  if (typeof text === "string") config.message.text = text;
  saveConfig();
  log.backend("Panel updated MOTD");
  res.json({ ok: true, message: config.message });
});

// ---- Config (matchmaking toggle etc.) ----
app.get("/ogfn-panel/api/config", (req, res) => res.json(config));
app.post("/ogfn-panel/api/config", requirePanelAuth, (req, res) => {
  const { bEnableMatchmaking, gameserver } = req.body || {};
  if (typeof bEnableMatchmaking === "boolean") config.bEnableMatchmaking = bEnableMatchmaking;
  if (gameserver && typeof gameserver === "object") {
    config.gameserver = { ...config.gameserver, ...gameserver };
  }
  saveConfig();
  res.json({ ok: true, config });
});

app.get("/ogfn-panel/api/gameserver/status", async (req, res) => {
  const { gameserverStatus } = require("../structs/gameserver");
  res.json(await gameserverStatus());
});

app.post("/ogfn-panel/api/gameserver/ensure", requirePanelAuth, async (req, res) => {
  const { ensureGameserver } = require("../structs/gameserver");
  const result = await ensureGameserver(req.body || {});
  res.json(result);
});

// ---- Cosmetics catalog ----
app.get("/ogfn-panel/api/cosmetics", (req, res) => {
  const result = searchCosmetics({
    search: req.query.search,
    type: req.query.type,
    customOnly: req.query.customOnly === "1" || req.query.customOnly === "true",
    limit: req.query.limit,
    offset: req.query.offset,
  });
  res.json(result);
});

app.get("/ogfn-panel/api/cosmetics/custom", (req, res) => {
  res.json({ items: loadCustomCosmetics() });
});

app.post("/ogfn-panel/api/cosmetics/custom", requirePanelAuth, (req, res) => {
  const result = addCustomCosmetic(req.body || {});
  if (result.ok) log.backend(`Panel registered custom cosmetic ${result.entry.templateId}`);
  res.json(result);
});

app.post("/ogfn-panel/api/cosmetics/custom/remove", requirePanelAuth, (req, res) => {
  const { templateId } = req.body || {};
  const result = removeCustomCosmetic(templateId);
  if (result.ok) log.backend(`Panel removed custom cosmetic ${templateId}`);
  res.json(result);
});

app.get("/ogfn-panel/api/custom-paks", (req, res) => {
  res.json({
    pakDir: PAK_DIR,
    files: listPakFiles(),
    registry: loadPakRegistry(),
    gamePath: config.gameserver?.gamePath || "",
  });
});

app.post("/ogfn-panel/api/custom-paks/register", requirePanelAuth, (req, res) => {
  const result = registerPakEntry(req.body || {});
  if (result.ok) log.backend(`Panel registered custom pak ${result.entry.pakFile}`);
  res.json(result);
});

app.post("/ogfn-panel/api/custom-paks/install", requirePanelAuth, (req, res) => {
  const gamePath = String(req.body?.gamePath || config.gameserver?.gamePath || "").trim();
  const result = installPaksToBuild(gamePath);
  if (result.ok) log.backend(`Installed ${result.installed.length} custom pak(s) -> ${result.dest}`);
  res.json(result);
});

app.post("/ogfn-panel/api/apply-owner-perks", requirePanelAuth, (req, res) => {
  const { accountId } = req.body || {};
  const targetId = accountId || config.owner?.accountId;
  if (!targetId) return res.status(400).json({ ok: false, reason: "accountId is required." });
  ensureAccountProfiles(targetId);
  const { formatOwnerDisplayName } = require("../structs/owner");
  const { sessions } = require("./auth");
  const username = config.owner?.username || "owner";
  const displayName = formatOwnerDisplayName(username);
  sessions.set(targetId, { displayName, username });
  res.json({ ok: true, accountId: targetId, displayName, banner: require("../structs/owner").getOwnerBanner() });
});

// ---- Cosmetics grants ----
app.post("/ogfn-panel/api/grant", requirePanelAuth, (req, res) => {
  const { accountId, templateId, owner, favorite, pinFirst } = req.body || {};
  if (!accountId || !templateId)
    return res.status(400).json({ ok: false, reason: "accountId and templateId are required." });
  ensureAccountProfiles(accountId);
  const result = grantCosmetic(accountId, templateId, { owner, favorite, pinFirst });
  if (result.ok) log.backend(`Panel granted ${templateId} to ${accountId.slice(0, 8)}`);
  res.json(result);
});

app.post("/ogfn-panel/api/grant-owner-skin", requirePanelAuth, (req, res) => {
  const { accountId, templateId, name, type, note } = req.body || {};
  if (!accountId || !templateId) {
    return res.status(400).json({ ok: false, reason: "accountId and templateId are required." });
  }
  ensureAccountProfiles(accountId);
  const result = grantOwnerSkin(accountId, { templateId, name, type, note });
  if (result.ok) {
    log.backend(`Panel OWNER skin ${templateId} -> ${accountId.slice(0, 8)}`);
  }
  res.json(result);
});

app.post("/ogfn-panel/api/repair-owner-locker", requirePanelAuth, (req, res) => {
  const { accountId } = req.body || {};
  if (!accountId) return res.status(400).json({ ok: false, reason: "accountId is required." });
  ensureAccountProfiles(accountId);
  const result = repairOwnerCosmetics(accountId);
  if (result.ok) log.backend(`Panel repaired owner locker for ${accountId.slice(0, 8)}`);
  res.json(result);
});

app.post("/ogfn-panel/api/grant-all", requirePanelAuth, (req, res) => {
  const { accountId, templateIds } = req.body || {};
  if (!accountId) return res.status(400).json({ ok: false, reason: "accountId is required." });
  ensureAccountProfiles(accountId);
  const result = grantAllCosmetics(accountId, templateIds);
  if (result.ok && result.granted) {
    log.backend(`Panel granted ${result.granted} cosmetics to ${accountId.slice(0, 8)}`);
  }
  res.json(result);
});

app.post("/ogfn-panel/api/vbucks", requirePanelAuth, (req, res) => {
  const { accountId, amount } = req.body || {};
  if (!accountId) return res.status(400).json({ ok: false, reason: "accountId is required." });
  ensureAccountProfiles(accountId);
  res.json(setVbucks(accountId, amount));
});

app.post("/ogfn-panel/api/vbucks/add", requirePanelAuth, (req, res) => {
  const { accountId, amount } = req.body || {};
  if (!accountId) return res.status(400).json({ ok: false, reason: "accountId is required." });
  ensureAccountProfiles(accountId);
  const result = addVbucks(accountId, amount);
  if (result.ok) log.backend(`Panel added ${amount} V-Bucks to ${accountId.slice(0, 8)}`);
  res.json(result);
});

app.post("/ogfn-panel/api/level", requirePanelAuth, (req, res) => {
  const { accountId, level } = req.body || {};
  if (!accountId) return res.status(400).json({ ok: false, reason: "accountId is required." });
  ensureAccountProfiles(accountId);
  res.json(setAccountLevel(accountId, level));
});

app.post("/ogfn-panel/api/battlepass", requirePanelAuth, (req, res) => {
  const { accountId, tier } = req.body || {};
  if (!accountId) return res.status(400).json({ ok: false, reason: "accountId is required." });
  ensureAccountProfiles(accountId);
  res.json(setBattlePassTier(accountId, tier));
});

// ---- Lookup / moderation ----
app.get("/ogfn-panel/api/lookup", (req, res) => {
  const target = normalizeTarget(req.query.username || req.query.accountId || req.query.target);
  if (!target.ok) return res.status(400).json(target);

  const username = target.username || resolveUsername(target.accountId, sessions);
  res.json({
    ok: true,
    accountId: target.accountId,
    username,
    banned: isBanned(target.accountId),
    ban: getBanInfo(target.accountId),
  });
});

app.get("/ogfn-panel/api/bans", (req, res) => {
  res.json({ bans: listBans() });
});

app.post("/ogfn-panel/api/ban", requirePanelAuth, (req, res) => {
  const { reason, bannedBy } = req.body || {};
  const target = normalizeTarget(req.body?.accountId || req.body?.username || req.body?.target);
  if (!target.ok) return res.status(400).json(target);

  const result = banAccount({
    accountId: target.accountId,
    username: target.username,
    reason,
    bannedBy,
  });
  if (!result.ok) return res.json(result);

  revokeAccountSessions(target.accountId);
  const kicked = kickClient(target.accountId, result.ban.reason);
  log.backend(`Banned ${target.accountId.slice(0, 8)} (${result.ban.reason})`);
  res.json({ ...result, kicked });
});

app.post("/ogfn-panel/api/unban", requirePanelAuth, (req, res) => {
  const target = normalizeTarget(req.body?.accountId || req.body?.username || req.body?.target);
  if (!target.ok) return res.status(400).json(target);

  const result = unbanAccount(target.accountId);
  if (result.ok) log.backend(`Unbanned ${target.accountId.slice(0, 8)}`);
  res.json(result);
});

app.post("/ogfn-panel/api/kick", requirePanelAuth, (req, res) => {
  const { reason } = req.body || {};
  const target = normalizeTarget(req.body?.accountId || req.body?.username || req.body?.target);
  if (!target.ok) return res.status(400).json(target);

  revokeAccountSessions(target.accountId);
  const kicked = kickClient(target.accountId, reason || "Kicked by server staff.");
  if (kicked) log.backend(`Kicked ${target.accountId.slice(0, 8)}`);
  res.json({ ok: true, kicked, accountId: target.accountId });
});

// ---- Account management ----
app.get("/ogfn-panel/api/check-user", async (req, res) => {
  const target = normalizeTarget(req.query.username || req.query.user || req.query.accountId);
  if (!target.ok) return res.status(400).json(target);

  ensureAccountProfiles(target.accountId);
  const summary = getAccountSummary(target.accountId);
  const username = target.username || resolveUsername(target.accountId, sessions);
  const presence = getPresence(target.accountId);
  let online = false;
  for (const [, c] of clients) {
    if (c.accountId === target.accountId) {
      online = true;
      break;
    }
  }

  res.json({
    ok: true,
    accountId: target.accountId,
    username,
    banned: isBanned(target.accountId),
    ban: getBanInfo(target.accountId),
    online,
    presence,
    ...summary,
  });
});

app.post("/ogfn-panel/api/create", (req, res) => {
  const username = String(req.body?.username || "").trim();
  if (!username || username.length < 2) {
    return res.status(400).json({ ok: false, reason: "Username must be at least 2 characters." });
  }

  const accountId = accountIdFromName(username);
  if (isBanned(accountId)) {
    return res.json({ ok: false, reason: "That account is banned." });
  }

  sessions.set(accountId, { displayName: username });
  ensureAccountProfiles(accountId);

  if (req.body?.discordUserId) setDiscordLink(req.body.discordUserId, username);

  log.backend(`Created account ${username}`);
  res.json({ ok: true, accountId, username });
});

app.post("/ogfn-panel/api/create-test-acc", requirePanelAuth, (req, res) => {
  const username = String(req.body?.username || `Test${Date.now().toString().slice(-6)}`).trim();
  const accountId = accountIdFromName(username);
  sessions.set(accountId, { displayName: username });
  ensureAccountProfiles(accountId);
  grantAllCosmetics(accountId);
  setVbucks(accountId, 999999);
  setBattlePassTier(accountId, 100);
  setAccountLevel(accountId, 100);

  log.backend(`Created test account ${username}`);
  res.json({ ok: true, accountId, username });
});

app.post("/ogfn-panel/api/create-host-account", requirePanelAuth, (req, res) => {
  const username = String(req.body?.username || `Host_${Date.now().toString().slice(-6)}`).trim();
  const accountId = accountIdFromName(username);
  sessions.set(accountId, { displayName: username });
  ensureAccountProfiles(accountId);
  setVbucks(accountId, 999999);
  setBattlePassTier(accountId, 100);

  log.backend(`Created host account ${username}`);
  res.json({ ok: true, accountId, username, host: true });
});

app.post("/ogfn-panel/api/delete", requirePanelAuth, (req, res) => {
  const target = normalizeTarget(req.body?.accountId || req.body?.username || req.body?.user);
  if (!target.ok) return res.status(400).json(target);

  const configOwner = config.owner?.accountId?.toLowerCase();
  if (configOwner && target.accountId === configOwner) {
    return res.json({ ok: false, reason: "Cannot delete the configured server owner." });
  }

  revokeAccountSessions(target.accountId);
  kickClient(target.accountId, "Account deleted");
  unbanAccount(target.accountId);
  const result = deleteAccount(target.accountId);
  sessions.delete(target.accountId);
  if (result.ok) log.backend(`Deleted account ${target.accountId.slice(0, 8)}`);
  res.json(result);
});

app.post("/ogfn-panel/api/change-username", (req, res) => {
  const oldUsername = String(req.body?.oldUsername || req.body?.username || "").trim();
  const newUsername = String(req.body?.newUsername || req.body?.new_name || "").trim();
  if (!oldUsername || !newUsername) {
    return res.status(400).json({ ok: false, reason: "oldUsername and newUsername are required." });
  }

  const result = changeUsername(oldUsername, newUsername);
  if (!result.ok) return res.json(result);

  sessions.delete(result.oldAccountId);
  sessions.set(result.newAccountId, { displayName: newUsername });
  if (req.body?.discordUserId) setDiscordLink(req.body.discordUserId, newUsername);

  log.backend(`Renamed ${oldUsername} -> ${newUsername}`);
  res.json(result);
});

app.post("/ogfn-panel/api/remove", requirePanelAuth, (req, res) => {
  const target = normalizeTarget(req.body?.accountId || req.body?.username || req.body?.user);
  const templateId = String(req.body?.templateId || req.body?.item || "").trim();
  if (!target.ok) return res.status(400).json(target);
  if (!templateId) return res.status(400).json({ ok: false, reason: "templateId or item is required." });

  ensureAccountProfiles(target.accountId);
  res.json(removeCosmetic(target.accountId, templateId));
});

app.post("/ogfn-panel/api/add", requirePanelAuth, (req, res) => {
  const target = normalizeTarget(req.body?.accountId || req.body?.username || req.body?.user);
  const pack = String(req.body?.pack || "").trim().toLowerCase();
  if (!target.ok) return res.status(400).json(target);
  if (!pack) return res.status(400).json({ ok: false, reason: "pack is required." });

  ensureAccountProfiles(target.accountId);

  if (pack === "all" || pack === "all-cosmetics" || pack === "cosmetics") {
    return res.json(grantAllCosmetics(target.accountId));
  }
  if (pack === "vbucks") {
    const amount = parseInt(req.body?.amount, 10) || 15000;
    return res.json(addVbucks(target.accountId, amount));
  }
  if (pack === "battlepass" || pack === "bp") {
    return res.json(setBattlePassTier(target.accountId, parseInt(req.body?.amount, 10) || 100));
  }
  if (pack === "level") {
    return res.json(setAccountLevel(target.accountId, parseInt(req.body?.amount, 10) || 100));
  }
  if (pack === "item" || pack === "skin") {
    const templateId = String(req.body?.item || req.body?.templateId || "").trim();
    if (!templateId) return res.status(400).json({ ok: false, reason: "item templateId required for item pack." });
    return res.json(grantCosmetic(target.accountId, templateId));
  }

  return res.status(400).json({
    ok: false,
    reason: "Unknown pack. Use: all, vbucks, battlepass, level, or item.",
  });
});

app.get("/ogfn-panel/api/shop", async (req, res) => {
  try {
    const catalog = await buildCatalog(parseInt(req.query.season, 10) || 4);
    const offers = [];
    for (const sf of catalog.storefronts || []) {
      for (const entry of sf.catalogEntries || []) {
        offers.push({
          offerId: entry.offerId,
          name: String(entry.devName || "").replace(/^\[VELOCITY\]\s*/i, ""),
          price: entry.prices?.[0]?.finalPrice ?? 0,
          templateId: entry.itemGrants?.[0]?.templateId || null,
          section: sf.name,
        });
      }
    }
    res.json({ ok: true, offers });
  } catch (err) {
    res.status(500).json({ ok: false, reason: err.message });
  }
});

app.post("/ogfn-panel/api/buy", async (req, res) => {
  const target = normalizeTarget(req.body?.accountId || req.body?.username || req.body?.user);
  if (!target.ok) return res.status(400).json(target);

  ensureAccountProfiles(target.accountId);
  const itemName = String(req.body?.item || req.body?.name || "").trim().toLowerCase();
  const offerId = String(req.body?.offerId || "").trim();

  let chosenOfferId = offerId;
  if (!chosenOfferId && itemName) {
    const catalog = await buildCatalog(4);
    for (const sf of catalog.storefronts || []) {
      for (const entry of sf.catalogEntries || []) {
        const name = String(entry.devName || "").toLowerCase();
        if (name.includes(itemName)) {
          chosenOfferId = entry.offerId;
          break;
        }
      }
      if (chosenOfferId) break;
    }
  }

  if (!chosenOfferId) {
    return res.json({ ok: false, reason: "Item not found in today's shop. Use exact name or offerId." });
  }

  const result = purchase(target.accountId, chosenOfferId);
  if (result.ok) log.backend(`Shop purchase ${chosenOfferId} for ${target.accountId.slice(0, 8)}`);
  res.json({ ...result, offerId: chosenOfferId });
});

app.post("/ogfn-panel/api/claim-vbucks", (req, res) => {
  const target = normalizeTarget(req.body?.accountId || req.body?.username || req.body?.user);
  if (!target.ok) return res.status(400).json(target);
  if (isBanned(target.accountId)) return res.json({ ok: false, reason: "Banned accounts cannot claim V-Bucks." });

  const claim = claimDailyVbucks(target.accountId, 250);
  if (!claim.ok) return res.json(claim);

  ensureAccountProfiles(target.accountId);
  const result = addVbucks(target.accountId, claim.amount);
  res.json({ ...result, claimed: claim.amount, claimDate: claim.claimDate });
});

app.post("/ogfn-panel/api/appeal", (req, res) => {
  const username = String(req.body?.username || "").trim();
  const target = normalizeTarget(username || req.body?.accountId);
  if (!target.ok) return res.status(400).json(target);

  const ban = getBanInfo(target.accountId);
  if (!ban) return res.json({ ok: false, reason: "You are not banned." });

  const result = submitAppeal({
    accountId: target.accountId,
    username: target.username || username,
    discordUserId: req.body?.discordUserId,
    reason: req.body?.reason,
  });
  if (result.ok) log.backend(`Ban appeal from ${target.accountId.slice(0, 8)}`);
  res.json(result);
});

app.get("/ogfn-panel/api/appeals", requirePanelAuth, (req, res) => {
  res.json({ appeals: listAppeals() });
});

app.get("/ogfn-panel/api/leaderboard", (req, res) => {
  const entries = getArenaLeaderboard(10).map((row) => ({
    ...row,
    username: resolveUsername(row.accountId, sessions),
  }));
  res.json({ entries });
});

app.get("/ogfn-panel/api/discord-link/:discordUserId", (req, res) => {
  const username = getDiscordLink(req.params.discordUserId);
  res.json({ ok: Boolean(username), username });
});

app.post("/ogfn-panel/api/discord-link", (req, res) => {
  const { discordUserId, username } = req.body || {};
  if (!discordUserId || !username) {
    return res.status(400).json({ ok: false, reason: "discordUserId and username are required." });
  }
  setDiscordLink(discordUserId, username);
  res.json({ ok: true, username });
});

// ---- Custom match codes ----
app.get("/ogfn-panel/api/match-codes", (req, res) => {
  res.json({ codes: listCustomMatchCodes() });
});

app.post("/ogfn-panel/api/match-codes", requirePanelAuth, (req, res) => {
  const result = addCustomMatchCode({
    code: req.body?.code,
    playlist: req.body?.playlist,
    region: req.body?.region,
    createdBy: req.body?.createdBy,
  });
  if (result.ok) log.backend(`Created match code ${result.entry.code}`);
  res.json(result);
});

app.post("/ogfn-panel/api/match-codes/remove", requirePanelAuth, (req, res) => {
  const result = removeCustomMatchCode(req.body?.code);
  if (result.ok) log.backend(`Removed match code ${result.code}`);
  res.json(result);
});

// ---- SAC codes ----
app.get("/ogfn-panel/api/sac", (req, res) => {
  res.json({ codes: listSacCodes() });
});

app.post("/ogfn-panel/api/sac", requirePanelAuth, (req, res) => {
  const result = addSacCode({
    code: req.body?.code,
    displayName: req.body?.displayName,
    createdBy: req.body?.createdBy,
  });
  if (result.ok) log.backend(`Created SAC ${result.entry.code}`);
  res.json(result);
});

app.post("/ogfn-panel/api/sac/remove", requirePanelAuth, (req, res) => {
  const result = removeSacCode(req.body?.code);
  if (result.ok) log.backend(`Removed SAC ${result.code}`);
  res.json(result);
});

// ---- Hotfixes ----
app.get("/ogfn-panel/api/hotfixes", (req, res) => {
  const files = fs
    .readdirSync(systemDir)
    .filter((f) => f.endsWith(".ini"))
    .map((f) => ({ name: f, content: fs.readFileSync(path.join(systemDir, f), "utf8") }));
  res.json(files);
});

app.post("/ogfn-panel/api/hotfixes", requirePanelAuth, (req, res) => {
  const { name, content } = req.body || {};
  if (!name || !/^[\w.-]+\.ini$/.test(name))
    return res.status(400).json({ ok: false, reason: "Valid .ini filename required." });
  fs.writeFileSync(path.join(systemDir, path.basename(name)), content ?? "");
  log.backend(`Panel saved hotfix ${name}`);
  res.json({ ok: true });
});

module.exports = app;
