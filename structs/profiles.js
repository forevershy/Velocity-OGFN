const fs = require("fs");
const path = require("path");
const { v4: uuid } = require("uuid");

const { nowIso, accountIdFromName } = require("../utils/functions");
const log = require("../utils/logger");

const PROFILE_DIR = process.env.VELOCITY_PROFILE_DIR || path.join(__dirname, "..", ".profiles");
const BANNER_CATALOG = require("../data/banners.json");

const DEFAULT_BANNER_ICON = "StandardBanner1";
const DEFAULT_BANNER_COLOR = "DefaultColor1";

// Cosmetics we grant by default so the locker isn't empty.
const DEFAULT_COSMETICS = [
  "AthenaCharacter:CID_001_Athena_Commando_F_Default",
  "AthenaCharacter:CID_002_Athena_Commando_F_Default",
  "AthenaCharacter:CID_003_Athena_Commando_F_Default",
  "AthenaCharacter:CID_004_Athena_Commando_F_Default",
  "AthenaCharacter:CID_005_Athena_Commando_M_Default",
  "AthenaCharacter:CID_006_Athena_Commando_M_Default",
  "AthenaCharacter:CID_007_Athena_Commando_M_Default",
  "AthenaCharacter:CID_008_Athena_Commando_M_Default",
  "AthenaPickaxe:DefaultPickaxe",
  "AthenaGlider:DefaultGlider",
  "AthenaDance:EID_DanceMoves",
];

function profileFile(accountId) {
  return path.join(PROFILE_DIR, `${accountId}.json`);
}

function loadAccountProfiles(accountId) {
  const file = profileFile(accountId);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function saveAccountProfiles(accountId) {
  const accountProfiles = store.get(accountId);
  if (!accountProfiles) return;
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  fs.writeFileSync(profileFile(accountId), JSON.stringify(accountProfiles, null, 2));
}

function pushProfileChanges(accountId, profileId, profile, changes, options = {}) {
  if (!changes.length) return false;

  const { notifyGift = true } = options;
  const { sendXmppMessageToId } = require("../xmpp/xmpp");
  const baseRevision = Math.max(0, profile.rvn - 1);
  const sent = sendXmppMessageToId(
    {
      type: "com.epicgames.fortnite.core.profile",
      payload: {
        profileId,
        profileRevision: profile.rvn,
        profileCommandRevision: profile.commandRevision,
        profileChangesBaseRevision: baseRevision,
        profileChanges: changes,
      },
      timestamp: nowIso(),
    },
    accountId
  );

  const shouldNotifyGift =
    notifyGift &&
    profileId === "athena" &&
    changes.some((c) => c.changeType === "itemAdded" || c.changeType === "fullProfileUpdate");

  if (shouldNotifyGift) {
    sendXmppMessageToId(
      {
        type: "com.epicgames.gift.received",
        payload: {},
        timestamp: nowIso(),
      },
      accountId
    );
  }

  if (sent) log.backend(`Pushed locker update to ${accountId.slice(0, 8)} (+${changes.length} change(s))`);
  return sent;
}

function pushProfileChangesBatched(accountId, profileId, profile, changes, chunkSize = 20) {
  if (!changes.length) return false;

  let anySent = false;
  for (let i = 0; i < changes.length; i += chunkSize) {
    const chunk = changes.slice(i, i + chunkSize);
    const isLast = i + chunkSize >= changes.length;
    if (pushProfileChanges(accountId, profileId, profile, chunk, { notifyGift: isLast })) {
      anySent = true;
    }
  }
  return anySent;
}

function isClientOnline(accountId) {
  const { clients } = require("../xmpp/xmpp");
  for (const [, c] of clients) {
    if (c.accountId === accountId) return true;
  }
  return false;
}

function ownsTemplate(profile, templateId) {
  const want = templateId.toLowerCase();
  return Object.values(profile.items).some((i) => i.templateId?.toLowerCase() === want);
}

function buildBannerItems() {
  const items = {};
  for (const color of BANNER_CATALOG.colors) {
    const templateId = `HomebaseBannerColor:${color}`;
    items[templateId] = { templateId, attributes: { item_seen: true }, quantity: 1 };
  }
  for (const icon of BANNER_CATALOG.icons) {
    const templateId = `HomebaseBannerIcon:${icon}`;
    items[templateId] = { templateId, attributes: { item_seen: true }, quantity: 1 };
  }
  return items;
}

function buildLockerItem() {
  return {
    sandbox_loadout: {
      templateId: "CosmeticLocker:cosmeticlocker_athena",
      attributes: {
        locker_slots_data: {
          slots: {
            MusicPack: { items: [""] },
            Character: { items: [""], activeVariants: [null] },
            Backpack: { items: [""], activeVariants: [null] },
            SkyDiveContrail: { items: [""], activeVariants: [null] },
            Dance: {
              items: ["AthenaDance:EID_DanceMoves", "", "", "", "", ""],
            },
            LoadingScreen: { items: [""] },
            Pickaxe: { items: ["AthenaPickaxe:DefaultPickaxe"], activeVariants: [null] },
            Glider: { items: ["AthenaGlider:DefaultGlider"], activeVariants: [null] },
            ItemWrap: {
              items: ["", "", "", "", "", "", ""],
              activeVariants: [null, null, null, null, null, null, null, null],
            },
          },
        },
        use_count: 0,
        banner_icon_template: DEFAULT_BANNER_ICON,
        banner_color_template: DEFAULT_BANNER_COLOR,
        locker_name: "OGFN",
        item_seen: true,
      },
      quantity: 1,
    },
  };
}

function buildAthenaItems() {
  const items = { ...buildLockerItem() };
  for (const templateId of DEFAULT_COSMETICS) {
    items[uuid()] = {
      templateId,
      attributes: {
        max_level_bonus: 0,
        level: 1,
        item_seen: true,
        xp: 0,
        variants: [],
        favorite: false,
      },
      quantity: 1,
    };
  }
  return items;
}

// The BR profile (locker, loadout, stats).
function createAthenaProfile(accountId) {
  return {
    created: nowIso(),
    updated: nowIso(),
    rvn: 1,
    wipeNumber: 1,
    accountId,
    profileId: "athena",
    version: "ogfn_v1",
    items: buildAthenaItems(),
    stats: {
      attributes: {
        use_random_loadout: false,
        past_seasons: [],
        season_match_boost: 0,
        loadouts: ["sandbox_loadout"],
        mfa_reward_claimed: true,
        rested_xp_overflow: 0,
        current_mtx_platform: "EpicPC",
        last_xp_interaction: nowIso(),
        book_level: 1,
        season_num: 1,
        book_xp: 0,
        creative_dynamic_xp: {},
        season: { numWins: 0, numHighBracket: 0, numLowBracket: 0 },
        battlestars: 0,
        battlestars_season_total: 0,
        book_purchased: false,
        lifetime_wins: 0,
        arena_hype: 0,
        party_assist_quest: "",
        purchased_battle_pass_tier_offers: {},
        rested_xp_exchange: 1,
        level: 1,
        xp_overflow: 0,
        rested_xp: 0,
        rested_xp_mult: 1,
        accountLevel: 1,
        competitive_identity: {},
        inventory_limit_bonus: 0,
        last_applied_loadout: "sandbox_loadout",
        daily_rewards: {},
        xp: 0,
        season_friend_match_boost: 0,
        active_loadout_index: 0,
        favorite_character: "AthenaCharacter:CID_001_Athena_Commando_F_Default",
        favorite_backpack: "",
        favorite_pickaxe: "AthenaPickaxe:DefaultPickaxe",
        favorite_glider: "AthenaGlider:DefaultGlider",
        favorite_skydivecontrail: "",
        favorite_dance: ["", "", "", "", "", ""],
        favorite_itemwraps: ["", "", "", "", "", "", ""],
        favorite_musicpack: "",
        favorite_loadingscreen: "",
        banner_icon: DEFAULT_BANNER_ICON,
        banner_color: DEFAULT_BANNER_COLOR,
      },
    },
    commandRevision: 1,
  };
}

// The common_core profile (V-Bucks, gifts, purchases).
function createCommonCoreProfile(accountId) {
  return {
    created: nowIso(),
    updated: nowIso(),
    rvn: 1,
    wipeNumber: 1,
    accountId,
    profileId: "common_core",
    version: "ogfn_v1",
    items: {
      Currency: {
        templateId: "Currency:MtxPurchased",
        attributes: { platform: "EpicPC" },
        quantity: 133700,
      },
      ...buildBannerItems(),
    },
    stats: {
      attributes: {
        mtx_purchase_history: { refundsUsed: 0, refundCredits: 3, purchases: [] },
        current_mtx_platform: "EpicPC",
        mtx_affiliate: "",
        forced_intro_played: "Coconut",
        weekly_purchases: {},
        daily_purchases: {},
        ban_history: {},
        in_app_purchases: {},
        permissions: [],
        undo_cooldowns: [],
        monthly_purchases: {},
        allowed_to_send_gifts: true,
        mfa_enabled: true,
        allowed_to_receive_gifts: true,
        gift_history: {},
      },
    },
    commandRevision: 1,
  };
}

const factories = {
  athena: createAthenaProfile,
  common_core: createCommonCoreProfile,
  profile0: createAthenaProfile,
  common_public: createCommonCoreProfile,
};

// Per-account profile cache (persisted to disk).
const store = new Map();

function getProfile(accountId, profileId) {
  if (!store.has(accountId)) {
    store.set(accountId, loadAccountProfiles(accountId) || {});
  }
  const accountProfiles = store.get(accountId);

  if (!accountProfiles[profileId]) {
    const factory = factories[profileId] || createCommonCoreProfile;
    accountProfiles[profileId] = factory(accountId);
    saveAccountProfiles(accountId);
  }
  return accountProfiles[profileId];
}

function ensureBannerCatalog(accountId) {
  const core = getProfile(accountId, "common_core");
  const athena = getProfile(accountId, "athena");
  let coreChanged = false;
  let athenaChanged = false;

  for (const color of BANNER_CATALOG.colors) {
    const templateId = `HomebaseBannerColor:${color}`;
    if (!ownsTemplate(core, templateId)) {
      core.items[templateId] = { templateId, attributes: { item_seen: true }, quantity: 1 };
      coreChanged = true;
    }
  }
  for (const icon of BANNER_CATALOG.icons) {
    const templateId = `HomebaseBannerIcon:${icon}`;
    if (!ownsTemplate(core, templateId)) {
      core.items[templateId] = { templateId, attributes: { item_seen: true }, quantity: 1 };
      coreChanged = true;
    }
  }

  if (!athena.items.sandbox_loadout) {
    Object.assign(athena.items, buildLockerItem());
    athenaChanged = true;
  }

  const attrs = athena.stats.attributes;
  if (!attrs.banner_icon) {
    attrs.banner_icon = DEFAULT_BANNER_ICON;
    athenaChanged = true;
  }
  if (!attrs.banner_color) {
    attrs.banner_color = DEFAULT_BANNER_COLOR;
    athenaChanged = true;
  }

  if (coreChanged) {
    core.rvn += 1;
    core.commandRevision += 1;
    core.updated = nowIso();
  }
  if (athenaChanged) {
    athena.rvn += 1;
    athena.commandRevision += 1;
    athena.updated = nowIso();
  }
  if (coreChanged || athenaChanged) saveAccountProfiles(accountId);
}

function findBannerItemId(profile, kind, shortId) {
  const want = `${kind}:${shortId}`.toLowerCase();
  for (const [itemId, item] of Object.entries(profile.items)) {
    if (item.templateId?.toLowerCase() === want) return itemId;
  }
  return null;
}

function ensureAccountProfiles(accountId) {
  getProfile(accountId, "athena");
  getProfile(accountId, "common_core");
  ensureBannerCatalog(accountId);
  applyOwnerPerks(accountId);
}

function applyOwnerPerks(accountId) {
  const { isOwnerAccount, getOwnerBanner } = require("./owner");
  if (!isOwnerAccount(accountId)) return false;

  const athena = getProfile(accountId, "athena");
  const { icon, color } = getOwnerBanner();
  let changed = false;

  if (athena.stats?.attributes) {
    if (athena.stats.attributes.banner_icon !== icon) {
      athena.stats.attributes.banner_icon = icon;
      changed = true;
    }
    if (athena.stats.attributes.banner_color !== color) {
      athena.stats.attributes.banner_color = color;
      changed = true;
    }
  }

  const loadoutId =
    athena.stats?.attributes?.loadouts?.[athena.stats.attributes.active_loadout_index || 0] ||
    athena.stats?.attributes?.last_applied_loadout ||
    "sandbox_loadout";
  const loadout = athena.items?.[loadoutId];
  if (loadout?.attributes) {
    if (loadout.attributes.banner_icon_template !== icon) {
      loadout.attributes.banner_icon_template = icon;
      changed = true;
    }
    if (loadout.attributes.banner_color_template !== color) {
      loadout.attributes.banner_color_template = color;
      changed = true;
    }
  }

  if (changed) {
    athena.rvn += 1;
    athena.commandRevision += 1;
    athena.updated = nowIso();
    saveAccountProfiles(accountId);
  }

  return true;
}

// ---- Panel helpers ----

function listAccounts() {
  const out = [];
  const seen = new Set();

  function pushSummary(accountId, profiles) {
    if (!profiles || seen.has(accountId)) return;
    seen.add(accountId);
    const athena = profiles.athena;
    const core = profiles.common_core;
    out.push({
      accountId,
      itemCount: athena ? Object.keys(athena.items).length : 0,
      vbucks: core?.items?.Currency?.quantity ?? 0,
      level: athena?.stats?.attributes?.level ?? 1,
      bookLevel: athena?.stats?.attributes?.book_level ?? 1,
    });
  }

  for (const [accountId, profiles] of store) pushSummary(accountId, profiles);

  try {
    if (fs.existsSync(PROFILE_DIR)) {
      for (const file of fs.readdirSync(PROFILE_DIR)) {
        if (!file.endsWith(".json")) continue;
        const accountId = file.slice(0, -5);
        if (seen.has(accountId)) continue;
        const profiles = loadAccountProfiles(accountId);
        if (profiles) pushSummary(accountId, profiles);
      }
    }
  } catch {
    /* best effort */
  }

  return out;
}

const COSMETIC_GRANT_POOL_PATH = path.join(__dirname, "..", "data", "shop-cosmetics.json");
const DEFAULT_GIFT_WRAP = "GiftBox:gb_default";

const OWNER_EQUIP_SLOTS = {
  AthenaCharacter: { stat: "favorite_character", loadout: "Character" },
  AthenaPickaxe: { stat: "favorite_pickaxe", loadout: "Pickaxe" },
  AthenaBackpack: { stat: "favorite_backpack", loadout: "Backpack" },
  AthenaGlider: { stat: "favorite_glider", loadout: "Glider" },
  AthenaSkyDiveContrail: { stat: "favorite_skydivecontrail", loadout: "SkyDiveContrail" },
  AthenaMusicPack: { stat: "favorite_musicpack", loadout: "MusicPack" },
  AthenaLoadingScreen: { stat: "favorite_loadingscreen", loadout: "LoadingScreen" },
};

/** Fix common panel typos and bare CIDs before granting. */
function normalizeCosmeticTemplateId(templateId, type = "skin") {
  let t = String(templateId || "").trim();
  if (!t) return t;

  t = t.replace(/^AthenaPickaze:/i, "AthenaPickaxe:");
  if (/^AthenaPickaxe:BID_/i.test(t)) t = t.replace(/^AthenaPickaxe:/i, "AthenaBackpack:");
  if (/^AthenaBackpack:Pickaxe_/i.test(t)) t = t.replace(/^AthenaBackpack:/i, "AthenaPickaxe:");
  if (/^AthenaBackpack:DefaultPickaxe/i.test(t)) t = t.replace(/^AthenaBackpack:/i, "AthenaPickaxe:");

  if (!t.includes(":")) {
    const prefixByType = {
      skin: "AthenaCharacter",
      pickaxe: "AthenaPickaxe",
      backpack: "AthenaBackpack",
      glider: "AthenaGlider",
      emote: "AthenaDance",
      dance: "AthenaDance",
      wrap: "AthenaItemWrap",
    };
    const prefix = prefixByType[String(type || "skin").toLowerCase()] || "AthenaCharacter";
    t = `${prefix}:${t}`;
  }
  return t;
}

/** Auto-equip an owner cosmetic into the active BR loadout (v4.5 uses item GUIDs). */
function applyOwnerEquip(athena, itemId, templateId) {
  const prefix = String(templateId).split(":")[0];
  const slot = OWNER_EQUIP_SLOTS[prefix];
  if (!slot || !athena?.stats?.attributes) return [];

  athena.stats.attributes[slot.stat] = itemId;

  const loadoutId =
    athena.stats.attributes.loadouts?.[athena.stats.attributes.active_loadout_index || 0] ||
    athena.stats.attributes.last_applied_loadout ||
    "sandbox_loadout";
  const loadout = athena.items?.[loadoutId];
  const lockerSlot = loadout?.attributes?.locker_slots_data?.slots?.[slot.loadout];
  if (lockerSlot) lockerSlot.items = [itemId];

  return [{ changeType: "statModified", name: slot.stat, value: itemId }];
}

/** Owner + favorited cosmetics first; loadout entries stay at the top. */
function sortAthenaLockerItems(athena) {
  if (!athena?.items) return;

  const loadouts = {};
  const owner = {};
  const favorited = {};
  const rest = {};

  for (const [id, item] of Object.entries(athena.items)) {
    if (id === "sandbox_loadout" || item?.templateId?.startsWith("CosmeticLocker:")) {
      loadouts[id] = item;
      continue;
    }
    if (item?.attributes?.ogfn_owner) owner[id] = item;
    else if (item?.attributes?.favorite) favorited[id] = item;
    else rest[id] = item;
  }

  athena.items = { ...loadouts, ...owner, ...favorited, ...rest };
}

function makeCosmeticItem(templateId, opts = {}) {
  const favorite = Boolean(opts.favorite);
  const owner = Boolean(opts.owner);
  return {
    templateId,
    attributes: {
      max_level_bonus: 0,
      level: 1,
      item_seen: false,
      xp: 0,
      variants: [],
      favorite,
      // Panel / custom clients can read these; stock Fortnite still uses pak rarity.
      ...(owner
        ? {
            rarity: "Owner",
            series: "Owner",
            ogfn_owner: true,
            ogfn_rarity: "owner",
          }
        : {}),
    },
    quantity: 1,
  };
}

/** Put `itemId` first in athena.items so locker lists it at the top when order is preserved. */
function pinItemFirst(athena, itemId, item) {
  const next = { [itemId]: item };
  for (const [id, existing] of Object.entries(athena.items || {})) {
    if (id === itemId) continue;
    next[id] = existing;
  }
  athena.items = next;
}

/** Only the new owner skin stays favorited among the same cosmetic family (e.g. skins). */
function clearFavoritesForPrefix(athena, templateId, exceptItemId) {
  const prefix = String(templateId).split(":")[0];
  if (!prefix) return;
  for (const [id, item] of Object.entries(athena.items || {})) {
    if (id === exceptItemId) continue;
    if (!item?.templateId?.startsWith(`${prefix}:`)) continue;
    if (item.attributes) item.attributes.favorite = false;
  }
}

function loadCosmeticGrantPool() {
  const ids = new Set();
  const add = (templateId) => {
    if (typeof templateId === "string" && templateId.includes(":")) ids.add(templateId);
  };

  try {
    const raw = JSON.parse(fs.readFileSync(COSMETIC_GRANT_POOL_PATH, "utf8"));
    if (Array.isArray(raw)) raw.forEach((entry) => add(entry.templateId));
  } catch {
    /* ignore */
  }

  try {
    const { loadCustomCosmetics } = require("./customCosmetics");
    for (const entry of loadCustomCosmetics()) add(entry.templateId);
  } catch {
    /* ignore */
  }

  return [...ids];
}

function makeGiftBoxItem(accountId, lootList) {
  return {
    templateId: DEFAULT_GIFT_WRAP,
    attributes: {
      fromAccountId: accountId,
      lootList,
      params: { userMessage: "" },
      level: 1,
      giftedOn: nowIso(),
    },
    quantity: 1,
  };
}

// Grant a cosmetic (e.g. "AthenaCharacter:CID_...") to an account's athena profile.
function grantCosmetic(accountId, templateId, opts = {}) {
  templateId = normalizeCosmeticTemplateId(templateId, opts.type);
  const athena = getProfile(accountId, "athena");
  if (ownsTemplate(athena, templateId)) {
    // Re-pin / re-favorite an already-owned item when granting as owner skin.
    if (opts.owner || opts.favorite || opts.pinFirst) {
      const existingId = Object.keys(athena.items || {}).find(
        (id) => athena.items[id]?.templateId === templateId
      );
      if (existingId) {
        const item = athena.items[existingId];
        item.attributes = item.attributes || {};
        item.attributes.favorite = true;
        if (opts.owner) {
          item.attributes.rarity = "Owner";
          item.attributes.series = "Owner";
          item.attributes.ogfn_owner = true;
          item.attributes.ogfn_rarity = "owner";
        }
        if (opts.pinFirst !== false) {
          clearFavoritesForPrefix(athena, templateId, existingId);
          pinItemFirst(athena, existingId, item);
        }
        const changes = [
          { changeType: "itemAttrChanged", itemId: existingId, attributeName: "favorite", attributeValue: true },
        ];
        if (opts.owner) {
          changes.push(...applyOwnerEquip(athena, existingId, templateId));
          sortAthenaLockerItems(athena);
        }
        athena.rvn += 1;
        athena.commandRevision += 1;
        athena.updated = nowIso();
        saveAccountProfiles(accountId);
        pushProfileChanges(accountId, "athena", athena, changes);
        return {
          ok: true,
          itemId: existingId,
          templateId,
          updated: true,
          owner: Boolean(opts.owner),
          equipped: Boolean(opts.owner),
        };
      }
    }
    return { ok: false, reason: "Item already owned." };
  }

  const core = getProfile(accountId, "common_core");
  const itemId = uuid();
  const item = makeCosmeticItem(templateId, {
    favorite: Boolean(opts.favorite || opts.owner),
    owner: Boolean(opts.owner),
  });

  if (opts.owner || opts.pinFirst) {
    clearFavoritesForPrefix(athena, templateId, itemId);
    pinItemFirst(athena, itemId, item);
  } else {
    athena.items[itemId] = item;
  }

  const equipChanges = opts.owner ? applyOwnerEquip(athena, itemId, templateId) : [];
  if (opts.owner) sortAthenaLockerItems(athena);

  const giftBoxItemId = uuid();
  const giftBoxItem = makeGiftBoxItem(accountId, [
    { itemType: templateId, itemGuid: itemId, itemProfile: "athena", quantity: 1 },
  ]);
  if (opts.owner) {
    giftBoxItem.attributes.params = {
      userMessage: "OWNER SKIN",
    };
  }
  core.items[giftBoxItemId] = giftBoxItem;

  athena.rvn += 1;
  athena.commandRevision += 1;
  athena.updated = nowIso();
  core.rvn += 1;
  core.commandRevision += 1;
  core.updated = nowIso();
  saveAccountProfiles(accountId);

  const coreSent = pushProfileChanges(
    accountId,
    "common_core",
    core,
    [{ changeType: "itemAdded", itemId: giftBoxItemId, item: giftBoxItem }],
    { notifyGift: false }
  );
  const athenaChanges = [{ changeType: "itemAdded", itemId, item }, ...equipChanges];
  const athenaSent = pushProfileChanges(accountId, "athena", athena, athenaChanges);

  return {
    ok: true,
    itemId,
    templateId,
    owner: Boolean(opts.owner),
    equipped: Boolean(opts.owner),
    live: coreSent || athenaSent,
    inGame: isClientOnline(accountId),
  };
}

/**
 * Register (optional) + grant any cosmetic as OWNER rarity, favorited and first in locker.
 */
function grantOwnerSkin(accountId, body = {}) {
  const name = String(body.name || "").trim();
  const type = String(body.type || "skin").trim().toLowerCase();
  let templateId = normalizeCosmeticTemplateId(body.templateId, type);

  if (!templateId) {
    return { ok: false, reason: "templateId is required (e.g. AthenaCharacter:CID_…)." };
  }

  const catalogTemplateId = templateId;

  try {
    const { addCustomCosmetic, loadCustomCosmetics, saveCustomCosmetics, resolveGrantTemplateId } =
      require("./customCosmetics");
    const list = loadCustomCosmetics();
    const idx = list.findIndex((e) => e.templateId.toLowerCase() === templateId.toLowerCase());
    if (idx < 0) {
      addCustomCosmetic({
        name: name || templateId.split(":")[1] || templateId,
        templateId,
        type,
        rarity: "owner",
        note: body.note || "Owner skin — pinned first in locker",
      });
    } else {
      list[idx] = {
        ...list[idx],
        rarity: "owner",
        name: name || list[idx].name,
        note: body.note || list[idx].note || "Owner skin — pinned first in locker",
      };
      saveCustomCosmetics(list);
    }

    templateId = resolveGrantTemplateId(catalogTemplateId);
  } catch {
    /* registration is best-effort */
  }

  // Drop ghost locker entries for custom IDs that do not exist in the client.
  if (templateId.toLowerCase() !== catalogTemplateId.toLowerCase()) {
    removeCosmetic(accountId, catalogTemplateId);
  }

  const result = grantCosmetic(accountId, templateId, {
    owner: true,
    favorite: true,
    pinFirst: true,
    type,
  });
  return {
    ...result,
    catalogTemplateId,
    grantTemplateId: templateId,
    usesFallback: templateId.toLowerCase() !== catalogTemplateId.toLowerCase(),
  };
}

/** Fix typo template IDs and re-equip the top owner skin in the locker. */
function repairOwnerCosmetics(accountId) {
  const athena = getProfile(accountId, "athena");
  let fixed = 0;

  for (const [id, item] of Object.entries(athena.items || {})) {
    if (!item?.templateId) continue;
    const normalized = normalizeCosmeticTemplateId(item.templateId);
    if (normalized !== item.templateId) {
      item.templateId = normalized;
      fixed += 1;
    }
  }

  const ownerCharacter = Object.entries(athena.items || {}).find(
    ([id, item]) =>
      id !== "sandbox_loadout" &&
      item?.attributes?.ogfn_owner &&
      item?.templateId?.startsWith("AthenaCharacter:")
  );

  const changes = [];
  if (ownerCharacter) {
    const [itemId, item] = ownerCharacter;
    item.attributes = item.attributes || {};
    item.attributes.favorite = true;
    clearFavoritesForPrefix(athena, item.templateId, itemId);
    pinItemFirst(athena, itemId, item);
    changes.push(
      { changeType: "itemAttrChanged", itemId, attributeName: "favorite", attributeValue: true },
      ...applyOwnerEquip(athena, itemId, item.templateId)
    );
  }

  sortAthenaLockerItems(athena);
  athena.rvn += 1;
  athena.commandRevision += 1;
  athena.updated = nowIso();
  saveAccountProfiles(accountId);
  if (changes.length) pushProfileChanges(accountId, "athena", athena, changes);

  return {
    ok: true,
    fixed,
    equipped: ownerCharacter?.[1]?.templateId || null,
    inGame: isClientOnline(accountId),
  };
}

function grantAllCosmetics(accountId, templateIds) {
  const athena = getProfile(accountId, "athena");
  const pool = Array.isArray(templateIds) && templateIds.length ? templateIds : loadCosmeticGrantPool();
  const changes = [];
  let skipped = 0;

  for (const templateId of pool) {
    if (typeof templateId !== "string" || !templateId.includes(":")) continue;
    if (templateId.startsWith("CosmeticLocker:") || templateId.startsWith("GiftBox:")) continue;
    if (ownsTemplate(athena, templateId)) {
      skipped += 1;
      continue;
    }

    const itemId = uuid();
    const item = makeCosmeticItem(templateId);
    athena.items[itemId] = item;
    changes.push({ changeType: "itemAdded", itemId, item });
  }

  if (!changes.length) {
    return {
      ok: true,
      granted: 0,
      skipped,
      live: false,
      inGame: isClientOnline(accountId),
      reason: skipped ? "You already own everything in this list." : "No cosmetics to grant.",
    };
  }

  athena.rvn += 1;
  athena.commandRevision += 1;
  athena.updated = nowIso();
  saveAccountProfiles(accountId);

  const live = pushProfileChangesBatched(accountId, "athena", athena, changes);

  return {
    ok: true,
    granted: changes.length,
    skipped,
    live,
    inGame: isClientOnline(accountId),
  };
}

// Set an account's V-Bucks balance.
function setVbucks(accountId, amount) {
  const profile = getProfile(accountId, "common_core");
  const quantity = Math.max(0, parseInt(amount, 10) || 0);
  profile.items.Currency.quantity = quantity;
  profile.rvn += 1;
  profile.commandRevision += 1;
  profile.updated = nowIso();
  saveAccountProfiles(accountId);

  pushProfileChanges(accountId, "common_core", profile, [
    { changeType: "itemQuantityChanged", itemId: "Currency", quantity },
  ]);

  return { ok: true, vbucks: quantity };
}

function addVbucks(accountId, amount) {
  const profile = getProfile(accountId, "common_core");
  const delta = parseInt(amount, 10) || 0;
  const quantity = Math.max(0, (profile.items.Currency.quantity || 0) + delta);
  profile.items.Currency.quantity = quantity;
  profile.rvn += 1;
  profile.commandRevision += 1;
  profile.updated = nowIso();
  saveAccountProfiles(accountId);

  pushProfileChanges(accountId, "common_core", profile, [
    { changeType: "itemQuantityChanged", itemId: "Currency", quantity },
  ]);

  return { ok: true, vbucks: quantity, added: delta };
}

function setAccountLevel(accountId, level) {
  const athena = getProfile(accountId, "athena");
  const lv = Math.max(1, Math.min(1000, parseInt(level, 10) || 1));
  athena.stats.attributes.level = lv;
  athena.stats.attributes.accountLevel = lv;
  athena.rvn += 1;
  athena.commandRevision += 1;
  athena.updated = nowIso();
  saveAccountProfiles(accountId);

  pushProfileChanges(accountId, "athena", athena, [
    { changeType: "statModified", name: "level", value: lv },
    { changeType: "statModified", name: "accountLevel", value: lv },
  ]);

  return { ok: true, level: lv };
}

function setBattlePassTier(accountId, tier) {
  const athena = getProfile(accountId, "athena");
  const bookLevel = Math.max(1, Math.min(100, parseInt(tier, 10) || 1));
  athena.stats.attributes.book_level = bookLevel;
  athena.stats.attributes.book_purchased = true;
  athena.rvn += 1;
  athena.commandRevision += 1;
  athena.updated = nowIso();
  saveAccountProfiles(accountId);

  pushProfileChanges(accountId, "athena", athena, [
    { changeType: "statModified", name: "book_level", value: bookLevel },
    { changeType: "statModified", name: "book_purchased", value: true },
  ]);

  return { ok: true, bookLevel };
}

function getAccountSummary(accountId) {
  const profiles = store.get(accountId) || loadAccountProfiles(accountId);
  if (!profiles) return null;

  const athena = profiles.athena;
  const core = profiles.common_core;
  return {
    accountId,
    itemCount: athena ? Object.keys(athena.items).length : 0,
    vbucks: core?.items?.Currency?.quantity ?? 0,
    level: athena?.stats?.attributes?.level ?? 1,
    bookLevel: athena?.stats?.attributes?.book_level ?? 1,
    arenaHype: athena?.stats?.attributes?.arena_hype ?? 0,
    lifetimeWins: athena?.stats?.attributes?.lifetime_wins ?? 0,
  };
}

function removeCosmetic(accountId, templateId) {
  const athena = getProfile(accountId, "athena");
  const want = String(templateId || "").toLowerCase();
  let removed = 0;
  const changes = [];

  for (const [itemId, item] of Object.entries(athena.items)) {
    if (item.templateId?.toLowerCase() !== want) continue;
    delete athena.items[itemId];
    changes.push({ changeType: "itemRemoved", itemId });
    removed += 1;
  }

  if (!removed) return { ok: false, reason: "Item not found in locker." };

  athena.rvn += 1;
  athena.commandRevision += 1;
  athena.updated = nowIso();
  saveAccountProfiles(accountId);
  pushProfileChangesBatched(accountId, "athena", athena, changes);

  return { ok: true, removed, templateId };
}

function deleteAccount(accountId) {
  const id = String(accountId || "").toLowerCase();
  store.delete(id);

  const file = profileFile(id);
  if (fs.existsSync(file)) {
    try {
      fs.unlinkSync(file);
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  }

  return { ok: true, accountId: id };
}

function changeUsername(oldUsername, newUsername) {
  const oldName = String(oldUsername || "").trim();
  const newName = String(newUsername || "").trim();
  if (!oldName || !newName) return { ok: false, reason: "Both usernames are required." };
  if (oldName.toLowerCase() === newName.toLowerCase()) {
    return { ok: false, reason: "New username must be different." };
  }

  const oldId = accountIdFromName(oldName);
  const newId = accountIdFromName(newName);

  const profiles = store.get(oldId) || loadAccountProfiles(oldId);
  if (!profiles) return { ok: false, reason: "Account not found." };
  if (store.get(newId) || fs.existsSync(profileFile(newId))) {
    return { ok: false, reason: "That username is already taken." };
  }

  if (profiles.athena) profiles.athena.accountId = newId;
  if (profiles.common_core) profiles.common_core.accountId = newId;

  store.set(newId, profiles);
  store.delete(oldId);
  saveAccountProfiles(newId);

  const oldFile = profileFile(oldId);
  if (fs.existsSync(oldFile)) {
    try {
      fs.unlinkSync(oldFile);
    } catch {
      /* ignore */
    }
  }

  return { ok: true, oldAccountId: oldId, newAccountId: newId, username: newName };
}

function getArenaLeaderboard(limit = 10) {
  const scores = new Map();

  for (const [accountId, profiles] of store) {
    const hype = profiles.athena?.stats?.attributes?.arena_hype ?? 0;
    if (hype > 0) scores.set(accountId, hype);
  }

  if (fs.existsSync(PROFILE_DIR)) {
    for (const file of fs.readdirSync(PROFILE_DIR)) {
      if (!file.endsWith(".json")) continue;
      const accountId = file.slice(0, -5);
      if (scores.has(accountId)) continue;
      const profiles = loadAccountProfiles(accountId);
      const hype = profiles?.athena?.stats?.attributes?.arena_hype ?? 0;
      if (hype > 0) scores.set(accountId, hype);
    }
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([accountId, arenaHype], index) => ({ rank: index + 1, accountId, arenaHype }));
}

module.exports = {
  getProfile,
  ensureAccountProfiles,
  ensureBannerCatalog,
  findBannerItemId,
  listAccounts,
  grantCosmetic,
  grantOwnerSkin,
  repairOwnerCosmetics,
  sortAthenaLockerItems,
  applyOwnerPerks,
  grantAllCosmetics,
  setVbucks,
  addVbucks,
  setAccountLevel,
  setBattlePassTier,
  loadCosmeticGrantPool,
  getAccountSummary,
  removeCosmetic,
  deleteAccount,
  changeUsername,
  getArenaLeaderboard,
  saveAccountProfiles,
  pushProfileChanges,
  pushProfileChangesBatched,
  store,
};
