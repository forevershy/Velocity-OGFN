const { displayNameFor, ensureSessionDisplayName } = require("../utils/accounts");
const { accountIdFromName } = require("../utils/functions");
const { stripOwnerTag } = require("./owner");
const {
  listFriends,
  listIncoming,
  listOutgoing,
  listBlocked,
  accountIdsForDiscovery,
} = require("./friendGraph");

function resolveAccountId(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^[a-f0-9]{32}$/i.test(raw)) return raw.toLowerCase();
  return accountIdFromName(stripOwnerTag(raw));
}

function friendSummary(forAccountId) {
  return listFriends(forAccountId).map((accountId) => ({
    accountId,
    groups: [],
    mutual: 0,
    alias: "",
    note: "",
    favorite: false,
    created: new Date().toISOString(),
  }));
}

function friendPublic(forAccountId) {
  const created = () => new Date().toISOString();
  const accepted = listFriends(forAccountId).map((accountId) => ({
    accountId,
    status: "ACCEPTED",
    direction: "OUTBOUND",
    created: created(),
    favorite: false,
  }));
  const incoming = listIncoming(forAccountId).map((accountId) => ({
    accountId,
    status: "PENDING",
    direction: "INBOUND",
    created: created(),
    favorite: false,
  }));
  const outgoing = listOutgoing(forAccountId).map((accountId) => ({
    accountId,
    status: "PENDING",
    direction: "OUTBOUND",
    created: created(),
    favorite: false,
  }));
  return [...accepted, ...incoming, ...outgoing];
}

function friendV1(forAccountId) {
  return friendSummary(forAccountId);
}

function incomingRequests(forAccountId) {
  return listIncoming(forAccountId).map((accountId) => ({
    accountId,
    groups: [],
    mutual: 0,
    alias: "",
    note: "",
    favorite: false,
    created: new Date().toISOString(),
  }));
}

function outgoingRequests(forAccountId) {
  return listOutgoing(forAccountId).map((accountId) => ({
    accountId,
    groups: [],
    mutual: 0,
    alias: "",
    note: "",
    favorite: false,
    created: new Date().toISOString(),
  }));
}

function blocklist(forAccountId) {
  return listBlocked(forAccountId).map((accountId) => ({ accountId }));
}

function searchAccounts(query, excludeAccountId) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [];

  const directId = resolveAccountId(q);
  const hits = new Map();

  if (directId) {
    hits.set(directId, {
      accountId: directId,
      displayName: displayNameFor(directId),
    });
  }

  for (const accountId of accountIdsForDiscovery()) {
    if (accountId === excludeAccountId) continue;
    const name = displayNameFor(accountId);
    const base = stripOwnerTag(name).toLowerCase();
    if (base.includes(q) || accountId.toLowerCase().includes(q)) {
      hits.set(accountId, { accountId, displayName: name });
    }
  }

  return [...hits.values()].slice(0, 20);
}

function ensureFriendProfiles(accountId, usernameHint) {
  if (usernameHint) ensureSessionDisplayName(accountId, usernameHint);
  try {
    const { ensureAccountProfiles } = require("./profiles");
    ensureAccountProfiles(accountId);
  } catch {
    /* ignore */
  }
}

module.exports = {
  displayNameFor,
  friendSummary,
  friendPublic,
  friendV1,
  incomingRequests,
  outgoingRequests,
  blocklist,
  searchAccounts,
  resolveAccountId,
  ensureFriendProfiles,
  accountIdsForDiscovery,
};
