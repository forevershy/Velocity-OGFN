const express = require("express");
const app = express.Router();

const {
  getProfile,
  saveAccountProfiles,
  ensureBannerCatalog,
  findBannerItemId,
  sortAthenaLockerItems,
} = require("../structs/profiles");
const { purchase: purchaseShopItem } = require("../structs/itemShop");
const { purchaseSeasonOffer, syncBattlePassRewards } = require("../structs/battlePass");
const { nowIso, getVersionInfo } = require("../utils/functions");
const log = require("../utils/logger");

// Wraps a profile into the MCP response envelope the client expects.
function profileResponse(profile, changes, rvnQuery) {
  return {
    profileRevision: profile.rvn,
    profileId: profile.profileId,
    profileChangesBaseRevision: profile.rvn,
    profileChanges: changes,
    profileCommandRevision: profile.commandRevision,
    serverTime: nowIso(),
    responseVersion: 1,
  };
}

// A "full" profile change (used on QueryProfile and after mutations).
function fullUpdate(profile) {
  return [{ changeType: "fullProfileUpdate", profile }];
}

app.post("/fortnite/api/game/v2/profile/:accountId/client/:operation", (req, res) => {
  const { accountId, operation } = req.params;
  const profileId = req.query.profileId || "common_core";
  const rvn = parseInt(req.query.rvn) || -1;

  const profile = getProfile(accountId, profileId);
  log.mcp(`${operation} on profile '${profileId}' for ${accountId.slice(0, 8)}`);

  let changes = [];
  let bump = false;

  const body = typeof req.body === "object" && !Buffer.isBuffer(req.body) ? req.body : {};

  switch (operation) {
    case "QueryProfile":
    case "ClientQuestLogin":
    case "RefreshExpeditions":
    case "GetMcpTimeForLogin":
    case "IncrementNamedCounterStat":
    case "SetHardcoreModifier":
    case "SetMtxPlatform":
    case "BulkEquipBattleRoyaleCustomization": {
      const { season } = getVersionInfo(req);
      if (season > 0 && profile.stats?.attributes) {
        profile.stats.attributes.season_num = season;
        if (profileId === "athena") {
          syncBattlePassRewards(accountId, season);
        }
      }
      if (profileId === "athena" || profileId === "common_core") {
        ensureBannerCatalog(accountId);
      }
      if (profileId === "athena") {
        const athena = getProfile(accountId, "athena");
        sortAthenaLockerItems(athena);
      }
      changes = fullUpdate(getProfile(accountId, profileId));
      break;
    }

    case "MarkItemSeen": {
      const ids = body.itemIds || [];
      for (const id of ids) {
        if (profile.items[id]) {
          profile.items[id].attributes.item_seen = true;
          changes.push({
            changeType: "itemAttrChanged",
            itemId: id,
            attributeName: "item_seen",
            attributeValue: true,
          });
        }
      }
      bump = true;
      break;
    }

    case "PurchaseCatalogEntry": {
      if (profileId !== "common_core" && profileId !== "profile0") {
        changes = fullUpdate(profile);
        break;
      }

      const offerId = body.offerId;
      const purchaseQuantity = body.purchaseQuantity || 1;
      const { season } = getVersionInfo(req);

      let result = purchaseSeasonOffer(accountId, offerId, purchaseQuantity, season);
      if (!result) result = purchaseShopItem(accountId, offerId, purchaseQuantity);

      if (!result.ok) {
        log.warn(`Purchase failed for ${accountId.slice(0, 8)}: ${result.reason}`);
        const wallet = getProfile(accountId, "common_core");
        changes = fullUpdate(wallet);
        break;
      }

      const wallet = getProfile(accountId, "common_core");
      const athena = getProfile(accountId, "athena");
      changes = result.coreChanges;
      bump = true;

      const response = profileResponse(wallet, changes, rvn);
      response.multiUpdate = [
        {
          profileRevision: athena.rvn,
          profileId: "athena",
          profileChangesBaseRevision: athena.rvn - 1,
          profileChanges: result.athenaChanges,
          profileCommandRevision: athena.commandRevision,
        },
      ];
      response.notifications = result.notifications;
      response.responseVersion = 1;
      return res.json(response);
    }

    case "SetItemFavoriteStatusBatch": {
      const ids = body.itemIds || [];
      const flags = body.itemFavStatus || [];
      ids.forEach((id, i) => {
        if (profile.items[id]) {
          profile.items[id].attributes.favorite = !!flags[i];
          changes.push({
            changeType: "itemAttrChanged",
            itemId: id,
            attributeName: "favorite",
            attributeValue: !!flags[i],
          });
        }
      });
      bump = true;
      break;
    }

    case "EquipBattleRoyaleCustomization": {
      const slot = body.slotName;
      const itemToSlot = body.itemToSlot;
      const indexWithinSlot = body.indexWithinSlot ?? 0;
      const map = {
        Character: "favorite_character",
        Backpack: "favorite_backpack",
        Pickaxe: "favorite_pickaxe",
        Glider: "favorite_glider",
        SkyDiveContrail: "favorite_skydivecontrail",
        MusicPack: "favorite_musicpack",
        LoadingScreen: "favorite_loadingscreen",
      };

      if (slot === "Dance") {
        profile.stats.attributes.favorite_dance[indexWithinSlot] = itemToSlot;
        changes.push({
          changeType: "statModified",
          name: "favorite_dance",
          value: profile.stats.attributes.favorite_dance,
        });
      } else if (slot === "ItemWrap") {
        if (indexWithinSlot === -1) {
          profile.stats.attributes.favorite_itemwraps =
            profile.stats.attributes.favorite_itemwraps.map(() => itemToSlot);
        } else {
          profile.stats.attributes.favorite_itemwraps[indexWithinSlot] = itemToSlot;
        }
        changes.push({
          changeType: "statModified",
          name: "favorite_itemwraps",
          value: profile.stats.attributes.favorite_itemwraps,
        });
      } else if (map[slot]) {
        profile.stats.attributes[map[slot]] = itemToSlot;
        changes.push({
          changeType: "statModified",
          name: map[slot],
          value: itemToSlot,
        });
      }
      bump = true;
      break;
    }

    case "SetBattleRoyaleBanner": {
      if (profileId !== "athena") {
        changes = fullUpdate(profile);
        break;
      }

      const iconId = body.homebaseBannerIconId;
      const colorId = body.homebaseBannerColorId;
      if (!iconId || !colorId) {
        changes = fullUpdate(profile);
        break;
      }

      const { build } = getVersionInfo(req);
      const bannerProfileId = build < 3.5 ? "profile0" : "common_core";
      const bannerProfile = getProfile(accountId, bannerProfileId);

      if (!findBannerItemId(bannerProfile, "HomebaseBannerIcon", iconId)) {
        log.warn(`Banner icon not owned: ${iconId}`);
        changes = fullUpdate(profile);
        break;
      }
      if (!findBannerItemId(bannerProfile, "HomebaseBannerColor", colorId)) {
        log.warn(`Banner color not owned: ${colorId}`);
        changes = fullUpdate(profile);
        break;
      }

      profile.stats.attributes.banner_icon = iconId;
      profile.stats.attributes.banner_color = colorId;
      changes.push(
        { changeType: "statModified", name: "banner_icon", value: iconId },
        { changeType: "statModified", name: "banner_color", value: colorId }
      );

      const loadoutId = profile.stats.attributes.loadouts?.[profile.stats.attributes.active_loadout_index || 0];
      const loadout = loadoutId ? profile.items[loadoutId] : null;
      if (loadout?.attributes) {
        loadout.attributes.banner_icon_template = iconId;
        loadout.attributes.banner_color_template = colorId;
        changes.push({
          changeType: "itemAttrChanged",
          itemId: loadoutId,
          attributeName: "banner_icon_template",
          attributeValue: iconId,
        });
        changes.push({
          changeType: "itemAttrChanged",
          itemId: loadoutId,
          attributeName: "banner_color_template",
          attributeValue: colorId,
        });
      }

      bump = true;
      break;
    }

    case "SetCosmeticLockerSlot":
    case "SetCosmeticLockerBanner":
    case "PutModularCosmeticLoadout":
      // Newer chapters store loadouts differently; just return a clean profile.
      changes = fullUpdate(profile);
      bump = true;
      break;

    default:
      // Unknown op: don't crash the client, just hand back the profile.
      log.warn(`Unhandled MCP operation: ${operation}`);
      changes = fullUpdate(profile);
      break;
  }

  if (bump) {
    profile.rvn += 1;
    profile.commandRevision += 1;
    profile.updated = nowIso();
    saveAccountProfiles(accountId);
    // Prepend nothing; the client applies deltas. If empty, send a full update.
    if (changes.length === 0) changes = fullUpdate(profile);
  }

  const response = profileResponse(profile, changes, rvn);
  // Newer clients send multiUpdate expectations; keep it simple/compatible.
  response.multiUpdate = [];
  res.json(response);
});

module.exports = app;
