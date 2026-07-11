const config = require("../config/config.json");
const { accountIdFromName } = require("../utils/functions");

const DEFAULT_OWNER_TAG = "[OWNER]";
const DEFAULT_OWNER_BANNER_ICON = "StandardBanner1";
const DEFAULT_OWNER_BANNER_COLOR = "DefaultColor1";

function stripOwnerTag(name) {
  const tag = getOwnerTag();
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return String(name || "")
    .replace(new RegExp(`^${escaped}\\s*`, "i"), "")
    .trim();
}

function getOwnerTag() {
  return String(config.owner?.displayTag || DEFAULT_OWNER_TAG).trim() || DEFAULT_OWNER_TAG;
}

function getOwnerConfig() {
  return config.owner || {};
}

function isOwnerAccount(accountId, username) {
  const owner = getOwnerConfig();
  const id = String(accountId || "").toLowerCase();
  const base = stripOwnerTag(username || "").toLowerCase();

  if (owner.accountId && id === String(owner.accountId).toLowerCase()) return true;
  if (owner.username && base === String(owner.username).toLowerCase()) return true;
  if (base && id === accountIdFromName(base).toLowerCase() && owner.username && base === owner.username.toLowerCase()) {
    return true;
  }
  return false;
}

function formatOwnerDisplayName(username) {
  const base = stripOwnerTag(username) || "Owner";
  if (!isOwnerAccount(accountIdFromName(base), base)) return base;
  const tag = getOwnerTag();
  if (base.toLowerCase().startsWith(tag.toLowerCase())) return base;
  return `${tag} ${base}`;
}

function getOwnerBanner() {
  const owner = getOwnerConfig();
  return {
    icon: String(owner.bannerIcon || DEFAULT_OWNER_BANNER_ICON).trim(),
    color: String(owner.bannerColor || DEFAULT_OWNER_BANNER_COLOR).trim(),
  };
}

module.exports = {
  stripOwnerTag,
  getOwnerTag,
  isOwnerAccount,
  formatOwnerDisplayName,
  getOwnerBanner,
};
