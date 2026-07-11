const fs = require("fs");
const path = require("path");
const { v4: uuid } = require("uuid");

const { nowIso } = require("../utils/functions");
const { getProfile, saveAccountProfiles, pushProfileChanges } = require("./profiles");
const log = require("../utils/logger");

const BP_DIR = path.join(__dirname, "..", "data", "battlepass");
const FULFILLMENT_TAG = "2B4936F24F3179416FEFD49DA5C4B64A";

const SEASON_PRICES = {
  2: { battlePass: 950, bundle: null, tier: 150 },
  3: { battlePass: 950, bundle: 2800, tier: 150 },
  4: { battlePass: 950, bundle: 2800, tier: 150 },
};

const defCache = new Map();

function loadDef(season) {
  if (defCache.has(season)) return defCache.get(season);
  const file = path.join(BP_DIR, `Season${season}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    const def = JSON.parse(fs.readFileSync(file, "utf8"));
    defCache.set(season, def);
    return def;
  } catch {
    return null;
  }
}

function mtxWallet(core) {
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

function ownsTemplate(profile, templateId) {
  return Object.values(profile.items).some((i) => i.templateId?.toLowerCase() === templateId.toLowerCase());
}

function addAthenaItem(athena, templateId, quantity, athenaChanges, lootItems) {
  if (ownsTemplate(athena, templateId)) return;
  const itemId = uuid();
  const item = {
    templateId,
    attributes: {
      max_level_bonus: 0,
      level: 1,
      item_seen: false,
      xp: 0,
      variants: [],
      favorite: false,
    },
    quantity,
  };
  athena.items[itemId] = item;
  athenaChanges.push({ changeType: "itemAdded", itemId, item });
  lootItems.push({ itemType: templateId, itemGuid: itemId, itemProfile: "athena", quantity });
}

function addBannerItem(core, templateId, coreChanges) {
  if (ownsTemplate(core, templateId)) return;
  const itemId = uuid();
  const item = { templateId, attributes: { item_seen: false }, quantity: 1 };
  core.items[itemId] = item;
  coreChanges.push({ changeType: "itemAdded", itemId, item });
}

function applyReward(templateId, amount, athena, core, athenaChanges, coreChanges, lootItems, purchased) {
  const key = templateId.toLowerCase();
  const attrs = athena.stats.attributes;

  if (key === "token:athenaseasonxpboost" || key === "token:athenaseasonmergedxpboosts") {
    attrs.season_match_boost = (attrs.season_match_boost || 0) + amount;
    athenaChanges.push({ changeType: "statModified", name: "season_match_boost", value: attrs.season_match_boost });
    return;
  }
  if (key === "token:athenaseasonfriendxpboost") {
    attrs.season_friend_match_boost = (attrs.season_friend_match_boost || 0) + amount;
    athenaChanges.push({
      changeType: "statModified",
      name: "season_friend_match_boost",
      value: attrs.season_friend_match_boost,
    });
    return;
  }
  if (key === "token:athenanextseasontierboost" || key.startsWith("challengebundleschedule:")) return;

  if (key === "currency:mtxgiveaway") {
    const wallet = mtxWallet(core);
    if (wallet) {
      wallet.item.quantity += amount;
      coreChanges.push({ changeType: "itemQuantityChanged", itemId: wallet.id, quantity: wallet.item.quantity });
    }
    return;
  }

  if (key.startsWith("accountresource:")) {
    attrs.book_xp = (attrs.book_xp || 0) + amount;
    athenaChanges.push({ changeType: "statModified", name: "book_xp", value: attrs.book_xp });
    return;
  }

  if (key.startsWith("homebasebannericon:")) {
    addBannerItem(core, templateId, coreChanges);
    return;
  }

  if (key.startsWith("athena") || key.startsWith("cosmetic")) {
    addAthenaItem(athena, templateId, amount, athenaChanges, lootItems);
  }
}

function collectTierRewards(def, athena, core, tierIndex, purchased, athenaChanges, coreChanges, lootItems) {
  const freeTier = def.freeRewards[tierIndex] || {};
  const paidTier = purchased ? def.paidRewards[tierIndex] || {} : {};

  for (const [templateId, amount] of Object.entries(freeTier)) {
    applyReward(templateId, amount, athena, core, athenaChanges, coreChanges, lootItems, purchased);
  }
  for (const [templateId, amount] of Object.entries(paidTier)) {
    applyReward(templateId, amount, athena, core, athenaChanges, coreChanges, lootItems, purchased);
  }
}

function grantTierRange(accountId, season, startTier, endTier, purchased) {
  const def = loadDef(season);
  if (!def) return { athenaChanges: [], coreChanges: [], lootItems: [] };

  const athena = getProfile(accountId, "athena");
  const core = getProfile(accountId, "common_core");
  const athenaChanges = [];
  const coreChanges = [];
  const lootItems = [];

  for (let i = startTier; i < endTier && i < def.paidRewards.length; i++) {
    collectTierRewards(def, athena, core, i, purchased, athenaChanges, coreChanges, lootItems);
  }

  return { athenaChanges, coreChanges, lootItems };
}

function syncBattlePassRewards(accountId, season) {
  const def = loadDef(season);
  if (!def) return;

  const athena = getProfile(accountId, "athena");
  const claimed = new Set(athena.stats.attributes.claimed_bp_tiers || []);
  const bookLevel = athena.stats.attributes.book_level || 1;
  const missing = [];

  for (let i = 0; i < bookLevel; i++) {
    if (!claimed.has(i)) missing.push(i);
  }
  if (!missing.length) return;

  const start = Math.min(...missing);
  const end = Math.max(...missing) + 1;
  const { athenaChanges, coreChanges } = grantTierRange(
    accountId,
    season,
    start,
    end,
    athena.stats.attributes.book_purchased
  );

  if (!athenaChanges.length && !coreChanges.length) return;

  const core = getProfile(accountId, "common_core");
  core.rvn += 1;
  core.commandRevision += 1;
  athena.rvn += 1;
  athena.commandRevision += 1;
  athena.stats.attributes.claimed_bp_tiers = [...claimed, ...missing].sort((a, b) => a - b);
  saveAccountProfiles(accountId);
  pushProfileChanges(accountId, "common_core", core, coreChanges);
  pushProfileChanges(accountId, "athena", athena, athenaChanges);
}

function catalogEntryBase(offerId, devName, price, opts = {}) {
  return {
    devName,
    offerId,
    fulfillmentIds: [],
    dailyLimit: -1,
    weeklyLimit: -1,
    monthlyLimit: -1,
    categories: [],
    prices: [
      {
        currencyType: "MtxCurrency",
        currencySubType: "",
        regularPrice: price.regular ?? price.final,
        finalPrice: price.final,
        saleExpiration: "2099-12-31T23:59:59.999Z",
        basePrice: price.final,
        ...(price.saleType ? { saleType: price.saleType } : {}),
      },
    ],
    meta: {},
    metaInfo: [],
    matchFilter: "",
    filterWeight: 0,
    appStoreId: [],
    requirements: opts.requirements || [],
    offerType: "StaticPrice",
    giftInfo: { bIsEnabled: false, forcedGiftBoxTemplateId: "", purchaseRequirements: [], giftRecordIds: [] },
    refundable: false,
    displayAssetPath: opts.displayAssetPath || "",
    itemGrants: [],
    sortPriority: opts.sortPriority ?? 0,
    catalogGroupPriority: 0,
    title: { en: opts.title || devName },
    shortDescription: { en: opts.shortDescription || "" },
    description: { en: opts.description || "" },
  };
}

function buildSeasonStorefront(season) {
  const def = loadDef(season);
  if (!def) return null;

  const prices = SEASON_PRICES[season] || SEASON_PRICES[4];
  const entries = [];

  if (def.battleBundleOfferId && prices.bundle) {
    entries.push(
      catalogEntryBase(
        def.battleBundleOfferId,
        `BR.Season${season}.BattleBundle.01`,
        { final: prices.bundle, regular: 4700, saleType: "PercentOff" },
        {
          requirements: [{ requirementType: "DenyOnFulfillment", requiredId: FULFILLMENT_TAG, minQuantity: 1 }],
          title: "Battle Bundle",
          shortDescription: "Battle Pass + 25 tiers!",
          displayAssetPath: `/Game/Catalog/DisplayAssets/DA_BR_Season${season}_BattlePassWithLevels.DA_BR_Season${season}_BattlePassWithLevels`,
        }
      )
    );
  }

  entries.push(
    catalogEntryBase(def.battlePassOfferId, `BR.Season${season}.BattlePass.01`, { final: prices.battlePass }, {
      requirements: [{ requirementType: "DenyOnFulfillment", requiredId: FULFILLMENT_TAG, minQuantity: 1 }],
      title: "Battle Pass",
      shortDescription: `Season ${season}`,
      displayAssetPath: `/Game/Catalog/DisplayAssets/DA_BR_Season${season}_BattlePass.DA_BR_Season${season}_BattlePass`,
      sortPriority: 1,
    })
  );

  entries.push(
    catalogEntryBase(def.tierOfferId, `BR.Season${season}.SingleTier.01`, { final: prices.tier }, {
      title: "Battle Pass Tier",
      shortDescription: "Get great rewards now!",
    })
  );

  return { name: `BRSeason${season}`, catalogEntries: entries };
}

function enrichCatalog(catalog, season) {
  if (!season || season < 2) return catalog;
  const storefront = buildSeasonStorefront(season);
  if (!storefront) return catalog;

  const idx = catalog.storefronts.findIndex((s) => s.name === storefront.name);
  if (idx >= 0) {
    catalog.storefronts[idx] = storefront;
  } else {
    catalog.storefronts.push(storefront);
  }
  return catalog;
}

function findSeasonOffer(offerId, season) {
  const def = loadDef(season);
  if (!def) return null;
  const prices = SEASON_PRICES[season] || SEASON_PRICES[4];
  if (offerId === def.battlePassOfferId) return { type: "battlePass", price: prices.battlePass, season };
  if (def.battleBundleOfferId && offerId === def.battleBundleOfferId)
    return { type: "bundle", price: prices.bundle, season };
  if (offerId === def.tierOfferId) return { type: "tier", price: prices.tier, season };
  return null;
}

function findSeasonOfferAnySeason(offerId) {
  for (const season of [10, 9, 8, 7, 6, 5, 4, 3, 2]) {
    const offer = findSeasonOffer(offerId, season);
    if (offer) return offer;
  }
  return null;
}

function purchaseSeasonOffer(accountId, offerId, quantity = 1, seasonHint) {
  const resolved =
    (seasonHint && findSeasonOffer(offerId, seasonHint)) || findSeasonOfferAnySeason(offerId);
  if (!resolved) return null;

  const { season, type, price } = resolved;
  if (!loadDef(season) || !price) return { ok: false, reason: "Battle pass not available for this season." };

  const core = getProfile(accountId, "common_core");
  const athena = getProfile(accountId, "athena");
  const qty = Math.max(1, parseInt(quantity, 10) || 1);
  const totalPrice = price * (type === "tier" ? qty : 1);

  const wallet = mtxWallet(core);
  if (!wallet) return { ok: false, reason: "No V-Bucks wallet found." };
  if (wallet.item.quantity < totalPrice) return { ok: false, reason: "Insufficient V-Bucks." };

  const attrs = athena.stats.attributes;
  attrs.season_num = season;

  let startTier = 0;
  let endTier = 0;

  if (type === "battlePass") {
    if (attrs.book_purchased) return { ok: false, reason: "Battle Pass already purchased." };
    attrs.book_purchased = true;
    if ((attrs.book_level || 1) < 1) attrs.book_level = 1;
    startTier = 0;
    endTier = attrs.book_level || 1;
  } else if (type === "bundle") {
    if (attrs.book_purchased) return { ok: false, reason: "Battle Pass already purchased." };
    attrs.book_purchased = true;
    attrs.book_level = Math.min(100, (attrs.book_level || 1) + 25);
    startTier = 0;
    endTier = attrs.book_level;
  } else if (type === "tier") {
    if ((attrs.book_level || 1) >= 100) return { ok: false, reason: "Already at max tier." };
    startTier = attrs.book_level || 1;
    attrs.book_level = Math.min(100, startTier + qty);
    endTier = attrs.book_level;
  }

  wallet.item.quantity -= totalPrice;
  const coreChanges = [
    { changeType: "itemQuantityChanged", itemId: wallet.id, quantity: wallet.item.quantity },
  ];

  const { athenaChanges: rewardAthena, coreChanges: rewardCore, lootItems } = grantTierRange(
    accountId,
    season,
    startTier,
    endTier,
    attrs.book_purchased
  );

  const athenaChanges = [
    { changeType: "statModified", name: "book_purchased", value: attrs.book_purchased },
    { changeType: "statModified", name: "book_level", value: attrs.book_level },
    { changeType: "statModified", name: "season_num", value: season },
    ...rewardAthena,
  ];

  const claimed = new Set(attrs.claimed_bp_tiers || []);
  for (let i = startTier; i < endTier; i++) claimed.add(i);
  attrs.claimed_bp_tiers = [...claimed].sort((a, b) => a - b);

  core.rvn += 1;
  core.commandRevision += 1;
  core.updated = nowIso();
  athena.rvn += 1;
  athena.commandRevision += 1;
  athena.updated = nowIso();

  saveAccountProfiles(accountId);
  pushProfileChanges(accountId, "common_core", core, [...coreChanges, ...rewardCore]);
  pushProfileChanges(accountId, "athena", athena, athenaChanges);

  log.backend(`Battle pass ${type} purchased by ${accountId.slice(0, 8)} (S${season} tier ${attrs.book_level})`);

  return {
    ok: true,
    coreChanges: [...coreChanges, ...rewardCore],
    athenaChanges,
    notifications: [{ type: "CatalogPurchase", primary: true, lootResult: { items: lootItems } }],
  };
}

module.exports = {
  loadDef,
  buildSeasonStorefront,
  enrichCatalog,
  purchaseSeasonOffer,
  syncBattlePassRewards,
  findSeasonOfferAnySeason,
};
