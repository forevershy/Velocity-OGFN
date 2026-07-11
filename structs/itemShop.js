const fs = require("fs");
const path = require("path");
const https = require("https");
const crypto = require("crypto");
const { v4: uuid } = require("uuid");

const { nowIso } = require("../utils/functions");
const { getProfile, saveAccountProfiles } = require("./profiles");
const log = require("../utils/logger");

const POOL_PATH = path.join(__dirname, "..", "data", "shop-cosmetics.json");
const LEGACY_POOL_PATH = path.join(__dirname, "..", "data", "shop-c1-legacy.json");
const CACHE_PATH =
  process.env.VELOCITY_SHOP_CACHE || path.join(__dirname, "..", "data", "shop-cache.json");

/** Shop rotates every N hours (UTC). */
const ROTATION_HOURS = 6;

/** @type {Array<{name:string,type:string,templateId:string,rarity:string,chapter:number,season:number}>} */
let cosmeticPool = [];
let cachedCatalog = null;
let cacheKey = null;
let rotationNonce = 0;

function rotationWindow() {
  const d = new Date();
  const block = Math.floor(d.getUTCHours() / ROTATION_HOURS);
  const key = `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}-b${block}-n${rotationNonce}`;
  const expires = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), (block + 1) * ROTATION_HOURS, 0, 0, 0)
  );
  return { key, expires: expires.toISOString() };
}

function loadLegacyPoolFromDisk() {
  if (!fs.existsSync(LEGACY_POOL_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(LEGACY_POOL_PATH, "utf8"));
  } catch {
    return [];
  }
}

function loadPoolFromDisk() {
  if (!fs.existsSync(POOL_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(POOL_PATH, "utf8"));
  } catch {
    return [];
  }
}

function fetchPoolFromApi() {
  return new Promise((resolve) => {
    https
      .get("https://fortnite-api.com/v2/cosmetics/br", { headers: { "User-Agent": "OGFN/1.0" } }, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            const allowed = new Set(["outfit", "pickaxe", "glider", "emote", "backpack"]);
            const items = (json.data || [])
              .filter((c) => allowed.has(c.type?.value) && c.introduction)
              .filter((c) => {
                const ch = parseInt(c.introduction.chapter, 10);
                const s = parseInt(c.introduction.season, 10);
                return ch === 1 || (ch === 2 && s <= 4);
              })
              .map((c) => ({
                name: c.name,
                type: c.type.value,
                templateId: `${c.type.backendValue}:${c.id}`,
                rarity: (c.rarity?.value || "rare").toLowerCase(),
                chapter: parseInt(c.introduction.chapter, 10),
                season: parseInt(c.introduction.season, 10),
              }));
            resolve(items);
          } catch {
            resolve([]);
          }
        });
      })
      .on("error", () => resolve([]))
      .setTimeout(20000, () => resolve([]));
  });
}

async function ensurePool() {
  if (cosmeticPool.length) return cosmeticPool;
  cosmeticPool = loadPoolFromDisk();
  if (cosmeticPool.length < 50) {
    const remote = await fetchPoolFromApi();
    if (remote.length) {
      cosmeticPool = remote;
      try {
        fs.mkdirSync(path.dirname(POOL_PATH), { recursive: true });
        fs.writeFileSync(POOL_PATH, JSON.stringify(remote));
      } catch {
        /* ignore */
      }
    }
  }
  return cosmeticPool;
}

function seededRandom(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) >>> 0;
  return () => {
    h = (Math.imul(1664525, h) + 1013904223) >>> 0;
    return h / 0xffffffff;
  };
}

function pickRandom(pool, count, seed) {
  const rng = seededRandom(seed);
  const arr = [...pool];
  const out = [];
  while (out.length < count && arr.length) {
    const i = Math.floor(rng() * arr.length);
    out.push(arr.splice(i, 1)[0]);
  }
  return out;
}

function pickRandomExcluding(pool, count, seed, exclude = []) {
  const blocked = new Set(exclude.map((i) => i.templateId));
  return pickRandom(
    pool.filter((i) => !blocked.has(i.templateId)),
    count,
    seed
  );
}

function dedupePool(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item?.templateId || seen.has(item.templateId)) continue;
    seen.add(item.templateId);
    out.push(item);
  }
  return out;
}

function buildSeasonPool(season) {
  const disk = cosmeticPool.length ? cosmeticPool : loadPoolFromDisk();
  const legacy = loadLegacyPoolFromDisk();
  const merged = dedupePool([...legacy, ...disk]);
  return filterPoolForSeason(merged, season);
}

function findPoolItem(templateId) {
  if (!templateId) return null;
  const want = templateId.toLowerCase();
  const pools = [cosmeticPool, loadPoolFromDisk(), loadLegacyPoolFromDisk()];
  for (const pool of pools) {
    const hit = pool.find((i) => i.templateId?.toLowerCase() === want);
    if (hit) return hit;
  }
  return null;
}

function priceForItem(item) {
  const map = {
    common: 500,
    uncommon: 700,
    rare: 1200,
    epic: 1500,
    legendary: 2000,
    marvel: 1800,
    dc: 1800,
    starwars: 1800,
    icon: 1500,
    frozen: 1500,
    lava: 1500,
    shadow: 1500,
    slurp: 1500,
    dark: 1500,
    gaminglegends: 1500,
  };
  const base = map[item.rarity] || 1200;
  if (item.type === "emote") return Math.max(200, base - 300);
  if (item.type === "pickaxe") return Math.max(500, base - 200);
  if (item.type === "glider") return Math.max(500, base - 100);
  return base;
}

function usesLegacyStorefront(season) {
  return season > 0 && season <= 10;
}

function filterPoolForSeason(pool, season) {
  if (!season || season >= 11) return pool;
  return pool.filter((item) => {
    if (!item.chapter || !item.season) return false;
    if (item.chapter === 1) return item.season <= season;
    if (item.chapter === 2 && season >= 11) return item.season <= season - 10;
    return false;
  });
}

function offerIdFor(templateId) {
  const hash = crypto
    .createHash("sha256")
    .update(templateId)
    .digest("base64")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
  return `v2:/${hash.slice(0, 64)}`;
}

function displayAssetPathFor(templateId, item = {}) {
  if (item.displayAssetPath) return item.displayAssetPath;

  const short = templateId.split(":")[1] || templateId;

  const character = short.match(/^CID_(\d+)_Athena_Commando_([MF])/i);
  if (character) {
    const gender = character[2].toUpperCase() === "M" ? "SMale" : "SFemale";
    const asset = `DA_Featured_${gender}HID${character[1]}`;
    return `/Game/Catalog/DisplayAssets/${asset}.${asset}`;
  }

  if (templateId.startsWith("AthenaGlider:")) {
    if (short === "Glider_ID_001") {
      return "/Game/Catalog/DisplayAssets/DA_Featured_GliderMiG.DA_Featured_GliderMiG";
    }
    const asset = `DA_Featured_${short.replace(/^Glider_/, "Glider")}`;
    return `/Game/Catalog/DisplayAssets/${asset}.${asset}`;
  }

  if (templateId.startsWith("AthenaPickaxe:")) {
    if (short === "Pickaxe_Lockjaw") {
      return "/Game/Catalog/DisplayAssets/DA_Featured_PickaxeLockjaw.DA_Featured_PickaxeLockjaw";
    }
    if (short.startsWith("Pickaxe_ID_")) {
      const asset = `DA_Featured_${short}`;
      return `/Game/Catalog/DisplayAssets/${asset}.${asset}`;
    }
    const compact = short.replace(/^Pickaxe_/, "Pickaxe").replace(/_/g, "");
    const asset = `DA_Featured_${compact}`;
    return `/Game/Catalog/DisplayAssets/${asset}.${asset}`;
  }

  if (templateId.startsWith("AthenaDance:")) {
    const asset = `DA_Featured_${short}`;
    return `/Game/Catalog/DisplayAssets/${asset}.${asset}`;
  }

  if (templateId.startsWith("AthenaBackpack:")) {
    const asset = `DA_Featured_${short}`;
    return `/Game/Catalog/DisplayAssets/${asset}.${asset}`;
  }

  const asset = `DA_Featured_${short}`;
  return `/Game/Catalog/DisplayAssets/${asset}.${asset}`;
}

function buildCatalogEntry(item, section, tileSize, options = {}) {
  const { legacy = false, layout = "season" } = options;
  const price = priceForItem(item);
  const offerId = legacy
    ? item.offerId || offerIdFor(item.templateId)
    : `velocity:${item.templateId}`;
  const displayAssetPath = legacy ? displayAssetPathFor(item.templateId, item) : "";
  const useTabMeta = legacy && (layout === "weekly" || layout === "daily");
  const usePanelCategories = legacy && layout === "season";
  const devName = legacy
    ? `[VIRTUAL]1 x ${item.name} for ${price} MtxCurrency`
    : `[VELOCITY] ${item.name}`;

  return {
    devName,
    offerId,
    fulfillmentIds: [],
    dailyLimit: -1,
    weeklyLimit: -1,
    monthlyLimit: -1,
    categories: usePanelCategories ? [section] : [],
    prices: [
      {
        currencyType: "MtxCurrency",
        currencySubType: "",
        regularPrice: price,
        finalPrice: price,
        saleExpiration: "2099-12-31T23:59:59.999Z",
        basePrice: price,
      },
    ],
    meta: useTabMeta
      ? { SectionId: section, TileSize: tileSize }
      : legacy
        ? {}
        : {
            SectionId: section,
            LayoutId: "Velocity.Shop",
            TileSize: tileSize,
            templateId: item.templateId,
            inDate: "2018-04-30T00:00:00.000Z",
            outDate: "2099-12-31T23:59:59.999Z",
          },
    metaInfo: useTabMeta
      ? [
          { key: "SectionId", value: section },
          { key: "TileSize", value: tileSize },
        ]
      : legacy
        ? []
        : [
            { key: "SectionId", value: section },
            { key: "LayoutId", value: "Velocity.Shop" },
            { key: "TileSize", value: tileSize },
            { key: "templateId", value: item.templateId },
          ],
    matchFilter: "",
    filterWeight: 0,
    appStoreId: [],
    requirements: [
      {
        requirementType: "DenyOnItemOwnership",
        requiredId: item.templateId,
        minQuantity: 1,
      },
    ],
    offerType: "StaticPrice",
    giftInfo: legacy
      ? {}
      : {
          bIsEnabled: true,
          forcedGiftBoxTemplateId: "",
          purchaseRequirements: [],
          giftRecordIds: [],
        },
    refundable: true,
    displayAssetPath,
    itemGrants: [{ templateId: item.templateId, quantity: 1 }],
    sortPriority: section === "Featured" || section.startsWith("Panel") ? -1 : 0,
    catalogGroupPriority: 0,
  };
}

async function buildCatalog(season = 0) {
  const { key, expires } = rotationWindow();
  const cacheId = `${key}:${season || "modern"}`;
  if (cachedCatalog && cacheKey === cacheId) return cachedCatalog;
  if (!cosmeticPool.length) await ensurePool();
  cachedCatalog = buildCatalogFromPool(key, expires, season);
  cacheKey = cacheId;
  try {
    fs.writeFileSync(CACHE_PATH, JSON.stringify({ day: cacheId, catalog: cachedCatalog }, null, 2));
  } catch {
    /* ignore */
  }
  const seasonStore = cachedCatalog.storefronts.find((s) => s.name === "BRSeasonStorefront");
  const featured = cachedCatalog.storefronts.find((s) => s.name === "BRWeeklyStorefront");
  const daily = cachedCatalog.storefronts.find((s) => s.name === "BRDailyStorefront");
  log.backend(
    `Item shop rotated (S${season || "?"}) — season:${seasonStore?.catalogEntries.length || 0} featured:${featured?.catalogEntries.length || 0} daily:${daily?.catalogEntries.length || 0} · next refresh ${expires}`
  );
  return cachedCatalog;
}

function buildCatalogFromPool(rotationKey, expiration, season = 0) {
  const pool = buildSeasonPool(season);
  cosmeticPool = cosmeticPool.length ? cosmeticPool : loadPoolFromDisk();

  const shell = {
    refreshIntervalHrs: ROTATION_HOURS,
    dailyPurchaseHrs: ROTATION_HOURS,
    expiration,
    storefronts: [
      { name: "BRDailyStorefront", catalogEntries: [] },
      { name: "BRWeeklyStorefront", catalogEntries: [] },
      { name: "BRSeasonStorefront", catalogEntries: [] },
    ],
  };

  if (!pool.length) return shell;

  if (usesLegacyStorefront(season)) {
    const preferred = pool.filter((i) => ["outfit", "pickaxe", "emote", "glider", "backpack"].includes(i.type));
    const source = preferred.length >= 12 ? preferred : pool;

    const featuredItems = pickRandom(source.filter((i) => i.type === "outfit"), 6, `${rotationKey}:featured:${season}`);
    const featuredFill = pickRandomExcluding(
      source,
      Math.max(0, 6 - featuredItems.length),
      `${rotationKey}:featured:fill:${season}`,
      featuredItems
    );
    const weeklyItems = [...featuredItems, ...featuredFill].slice(0, 6);

    const dailyItems = pickRandomExcluding(
      source.filter((i) => ["pickaxe", "glider", "emote", "backpack"].includes(i.type)),
      6,
      `${rotationKey}:daily:${season}`,
      weeklyItems
    );
    const dailyFill = pickRandomExcluding(source, Math.max(0, 6 - dailyItems.length), `${rotationKey}:daily:fill:${season}`, [
      ...weeklyItems,
      ...dailyItems,
    ]);
    const dailyFinal = [...dailyItems, ...dailyFill].slice(0, 6);

    const seasonItems = pickRandomExcluding(source, 6, `${rotationKey}:season:${season}`, [...weeklyItems, ...dailyFinal]);

    return {
      ...shell,
      storefronts: [
        {
          name: "BRWeeklyStorefront",
          catalogEntries: weeklyItems.map((item) =>
            buildCatalogEntry(item, "Featured", "Normal", { legacy: true, layout: "weekly" })
          ),
        },
        {
          name: "BRDailyStorefront",
          catalogEntries: dailyFinal.map((item) =>
            buildCatalogEntry(item, "Daily", "Small", { legacy: true, layout: "daily" })
          ),
        },
        {
          name: "BRSeasonStorefront",
          catalogEntries: seasonItems.map((item, i) =>
            buildCatalogEntry(item, `Panel ${i + 1}`, "Normal", { legacy: true, layout: "season" })
          ),
        },
      ],
    };
  }

  const outfits = pool.filter((i) => i.type === "outfit");
  const other = pool.filter((i) => i.type !== "outfit");

  const featured = pickRandom(outfits.length >= 6 ? outfits : pool, 6, `${rotationKey}:featured:${season || "all"}`);
  const daily = pickRandomExcluding(
    other.length >= 8 ? other : pool,
    8,
    `${rotationKey}:daily:${season || "all"}`,
    featured
  );

  return {
    ...shell,
    storefronts: [
      {
        name: "BRWeeklyStorefront",
        catalogEntries: featured.map((item) => buildCatalogEntry(item, "Featured", "Normal")),
      },
      {
        name: "BRDailyStorefront",
        catalogEntries: daily.map((item) => buildCatalogEntry(item, "Daily", "Small")),
      },
    ],
  };
}

function forceRotateShop() {
  rotationNonce += 1;
  cachedCatalog = null;
  cacheKey = null;
  try {
    if (fs.existsSync(CACHE_PATH)) fs.unlinkSync(CACHE_PATH);
  } catch {
    /* ignore */
  }
}

function ensureCatalogReady(season = 0) {
  const { key, expires } = rotationWindow();
  const cacheId = `${key}:${season || "modern"}`;
  if (cachedCatalog && cacheKey === cacheId) return cachedCatalog;

  if (fs.existsSync(CACHE_PATH)) {
    try {
      const cached = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
      if (cached.day === cacheId && cached.catalog) {
        cachedCatalog = cached.catalog;
        cacheKey = cacheId;
        return cachedCatalog;
      }
    } catch {
      /* ignore */
    }
  }

  if (!cosmeticPool.length) cosmeticPool = loadPoolFromDisk();
  cachedCatalog = buildCatalogFromPool(key, expires, season);
  cacheKey = cacheId;
  return cachedCatalog;
}

function findOffer(offerId) {
  for (const season of [14, 10, 9, 8, 7, 6, 5, 4, 3, 2, 0]) {
    ensureCatalogReady(season);
    if (!cachedCatalog) continue;
    for (const sf of cachedCatalog.storefronts) {
      const entry = sf.catalogEntries.find((e) => e.offerId === offerId);
      if (entry) return entry;
    }
  }

  if (offerId.startsWith("velocity:")) {
    const templateId = offerId.slice("velocity:".length);
    const item = findPoolItem(templateId);
    if (item) return buildCatalogEntry(item, "Featured", "Normal");
  }

  for (const item of dedupePool([...loadLegacyPoolFromDisk(), ...loadPoolFromDisk()])) {
    const id = item.offerId || offerIdFor(item.templateId);
    if (id === offerId) {
      return buildCatalogEntry(item, "Featured", "Normal", { legacy: true, layout: "weekly" });
    }
  }

  return null;
}

function ownsTemplate(athena, templateId) {
  return Object.values(athena.items).some((i) => i.templateId === templateId);
}

function mtxItem(core) {
  const platform = core.stats?.attributes?.current_mtx_platform || "EpicPC";
  for (const [id, item] of Object.entries(core.items)) {
    if (!item.templateId?.toLowerCase().startsWith("currency:mtx")) continue;
    const p = item.attributes?.platform || "shared";
    if (p.toLowerCase() === platform.toLowerCase() || p.toLowerCase() === "shared") {
      return { id, item };
    }
  }
  return null;
}

function purchase(accountId, offerId, quantity = 1) {
  const offer = findOffer(offerId);
  if (!offer) return { ok: false, reason: "Offer not found." };

  const core = getProfile(accountId, "common_core");
  const athena = getProfile(accountId, "athena");
  const qty = Math.max(1, parseInt(quantity, 10) || 1);
  const price = (offer.prices[0]?.finalPrice || 0) * qty;

  const currency = mtxItem(core);
  if (!currency) return { ok: false, reason: "No V-Bucks wallet found." };
  if (currency.item.quantity < price) {
    return { ok: false, reason: "Insufficient V-Bucks." };
  }

  const coreChanges = [];
  const athenaChanges = [];
  const lootItems = [];

  for (const grant of offer.itemGrants) {
    for (let n = 0; n < qty * (grant.quantity || 1); n++) {
      if (ownsTemplate(athena, grant.templateId)) continue;

      const itemId = uuid();
      const item = {
        templateId: grant.templateId,
        attributes: {
          max_level_bonus: 0,
          level: 1,
          item_seen: false,
          xp: 0,
          variants: [],
          favorite: false,
        },
        quantity: 1,
      };
      athena.items[itemId] = item;
      athenaChanges.push({ changeType: "itemAdded", itemId, item });
      lootItems.push({
        itemType: grant.templateId,
        itemGuid: itemId,
        itemProfile: "athena",
        quantity: 1,
      });
    }
  }

  if (!athenaChanges.length) {
    return { ok: false, reason: "You already own this item." };
  }

  currency.item.quantity -= price;
  coreChanges.push({
    changeType: "itemQuantityChanged",
    itemId: currency.id,
    quantity: currency.item.quantity,
  });

  core.rvn += 1;
  core.commandRevision += 1;
  core.updated = nowIso();
  athena.rvn += 1;
  athena.commandRevision += 1;
  athena.updated = nowIso();
  saveAccountProfiles(accountId);

  const { pushProfileChanges } = require("./profiles");
  pushProfileChanges(accountId, "common_core", core, coreChanges);
  pushProfileChanges(accountId, "athena", athena, athenaChanges);

  log.backend(`Shop purchase ${offerId} by ${accountId.slice(0, 8)} (-${price} V-Bucks)`);

  return {
    ok: true,
    coreChanges,
    athenaChanges,
    notifications: [
      {
        type: "CatalogPurchase",
        primary: true,
        lootResult: { items: lootItems },
      },
    ],
  };
}

// Warm pool + shop on startup (non-blocking).
ensurePool()
  .then(() => buildCatalog())
  .catch(() => {});

module.exports = {
  buildCatalog,
  findOffer,
  purchase,
  ensurePool,
  ensureCatalogReady,
  forceRotateShop,
  rotationWindow,
  ROTATION_HOURS,
};
