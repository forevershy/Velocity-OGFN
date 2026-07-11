const express = require("express");
const app = express.Router();

const { nowIso } = require("../utils/functions");
const { buildCatalog, ensureCatalogReady, rotationWindow, ROTATION_HOURS } = require("../structs/itemShop");
const { enrichCatalog } = require("../structs/battlePass");
const { getVersionInfo } = require("../utils/functions");

function emptyCatalog() {
  const { expires } = rotationWindow();
  return {
    refreshIntervalHrs: ROTATION_HOURS,
    dailyPurchaseHrs: ROTATION_HOURS,
    expiration: expires,
    storefronts: [
      { name: "BRDailyStorefront", catalogEntries: [] },
      { name: "BRWeeklyStorefront", catalogEntries: [] },
      { name: "BRSeasonStorefront", catalogEntries: [] },
    ],
  };
}

async function serveCatalog(req, res) {
  try {
    const { season } = getVersionInfo(req);
    const catalog = enrichCatalog(await buildCatalog(season), season);
    res.json(catalog);
  } catch {
    try {
      const { season } = getVersionInfo(req);
      const catalog = enrichCatalog(ensureCatalogReady(season), season);
      res.json(catalog);
    } catch {
      res.json(emptyCatalog());
    }
  }
}

// ---- Item shop (random daily + featured cosmetics, S1â€“S4 pool) ----
app.get("/fortnite/api/storefront/v2/catalog", serveCatalog);
app.get("/fortnite/api/storefront/v1/catalog", serveCatalog);

app.get("/fortnite/api/storefront/v2/keychain", (req, res) => res.json([]));

app.get("/catalog/api/shared/bulk/offers", (req, res) => res.json({}));

// ---- Gift/eligibility ----
app.get("/fortnite/api/storefront/v2/gift/check_eligibility/recipient/:recipientId/offer/:offerId", (req, res) =>
  res.json({ price: 0, bIsEnabled: true })
);

// ---- Affiliate (support-a-creator) ----
app.get("/affiliate/api/public/affiliates/slug/:slug", (req, res) =>
  res.json({
    id: req.params.slug,
    slug: req.params.slug,
    displayName: req.params.slug,
    status: "ACTIVE",
    verified: true,
    created: nowIso(),
    lastUpdated: nowIso(),
  })
);

module.exports = app;
