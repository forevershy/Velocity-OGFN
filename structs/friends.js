// Friend list helpers — backed by persisted friend graph + live sessions.
const { listFriends, listIncoming, listOutgoing, accountIdsForDiscovery } = require("./friendGraph");
const { displayNameFor, isAccountOnline } = require("../utils/accounts");

function resolveFriendIds(forAccountId) {
  const explicit = listFriends(forAccountId);
  if (explicit.length) return explicit;
  // Before anyone adds friends, show other known accounts so search/party still works.
  return accountIdsForDiscovery().filter((id) => id !== forAccountId);
}

function friendSummary(forAccountId) {
  return resolveFriendIds(forAccountId).map((accountId) => ({
    accountId,
    groups: [],
    alias: "",
    note: "",
    favorite: false,
    created: new Date().toISOString(),
  }));
}

function friendPublic(forAccountId) {
  return resolveFriendIds(forAccountId).map((accountId) => ({
    accountId,
    status: isAccountOnline(accountId) ? "ONLINE" : "OFFLINE",
    created: new Date().toISOString(),
  }));
}

function friendV1(forAccountId) {
  return friendSummary(forAccountId);
}

function incomingRequests(forAccountId) {
  return listIncoming(forAccountId).map((accountId) => ({
    accountId,
    groups: [],
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
    alias: "",
    note: "",
    favorite: false,
    created: new Date().toISOString(),
  }));
}

module.exports = {
  displayNameFor,
  friendSummary,
  friendPublic,
  friendV1,
  incomingRequests,
  outgoingRequests,
  resolveFriendIds,
};
