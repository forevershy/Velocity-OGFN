const fs = require("fs");
const path = require("path");
const { nowIso } = require("../utils/functions");

const STORE_PATH = path.join(__dirname, "..", "data", "friends-graph.json");

/** @type {{ accounts: Record<string, { friends: string[], incoming: string[], outgoing: string[], blocked: string[] }> }} */
let store = { accounts: {} };

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
    store = raw && typeof raw === "object" ? raw : { accounts: {} };
    if (!store.accounts) store.accounts = {};
  } catch {
    store = { accounts: {} };
  }
}

function save() {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

function ensureAccount(accountId) {
  if (!accountId) return null;
  if (!store.accounts[accountId]) {
    store.accounts[accountId] = { friends: [], incoming: [], outgoing: [], blocked: [] };
  }
  return store.accounts[accountId];
}

function uniq(list) {
  return [...new Set((list || []).filter(Boolean))];
}

function removeFrom(list, id) {
  return (list || []).filter((x) => x !== id);
}

function areFriends(a, b) {
  const row = store.accounts[a];
  return row?.friends?.includes(b) || false;
}

function listFriends(accountId) {
  return uniq(ensureAccount(accountId)?.friends || []);
}

function listIncoming(accountId) {
  return uniq(ensureAccount(accountId)?.incoming || []);
}

function listOutgoing(accountId) {
  return uniq(ensureAccount(accountId)?.outgoing || []);
}

function listBlocked(accountId) {
  return uniq(ensureAccount(accountId)?.blocked || []);
}

function registerAccount(accountId) {
  ensureAccount(accountId);
  save();
}

function addFriendship(a, b) {
  const rowA = ensureAccount(a);
  const rowB = ensureAccount(b);
  rowA.friends = uniq([...rowA.friends, b]);
  rowB.friends = uniq([...rowB.friends, a]);
  rowA.incoming = removeFrom(rowA.incoming, b);
  rowA.outgoing = removeFrom(rowA.outgoing, b);
  rowB.incoming = removeFrom(rowB.incoming, a);
  rowB.outgoing = removeFrom(rowB.outgoing, a);
  save();
}

function sendRequest(fromId, toId) {
  if (!fromId || !toId || fromId === toId) return { ok: false, reason: "invalid" };
  if (areFriends(fromId, toId)) return { ok: true, status: "already_friends" };

  const fromRow = ensureAccount(fromId);
  const toRow = ensureAccount(toId);

  if (toRow.incoming.includes(fromId) || fromRow.outgoing.includes(toId)) {
    return { ok: true, status: "pending" };
  }

  // If they already sent us a request, accept immediately.
  if (fromRow.incoming.includes(toId)) {
    addFriendship(fromId, toId);
    return { ok: true, status: "accepted" };
  }

  fromRow.outgoing = uniq([...fromRow.outgoing, toId]);
  toRow.incoming = uniq([...toRow.incoming, fromId]);
  save();
  return { ok: true, status: "sent" };
}

function acceptRequest(accountId, friendId) {
  const row = ensureAccount(accountId);
  if (!row.incoming.includes(friendId)) return { ok: false, reason: "no_request" };
  addFriendship(accountId, friendId);
  return { ok: true, status: "accepted" };
}

function removeFriend(accountId, friendId) {
  const rowA = ensureAccount(accountId);
  const rowB = ensureAccount(friendId);
  rowA.friends = removeFrom(rowA.friends, friendId);
  rowB.friends = removeFrom(rowB.friends, accountId);
  rowA.incoming = removeFrom(rowA.incoming, friendId);
  rowA.outgoing = removeFrom(rowA.outgoing, friendId);
  rowB.incoming = removeFrom(rowB.incoming, accountId);
  rowB.outgoing = removeFrom(rowB.outgoing, accountId);
  save();
  return { ok: true };
}

function accountIdsForDiscovery() {
  const ids = new Set(Object.keys(store.accounts));
  try {
    const { sessions } = require("../routes/auth");
    for (const id of sessions.keys()) ids.add(id);
  } catch {
    /* ignore */
  }
  try {
    const { clients } = require("../xmpp/xmpp");
    for (const [, c] of clients) {
      if (c.accountId) ids.add(c.accountId);
    }
  } catch {
    /* ignore */
  }
  try {
    const { listAccounts } = require("./profiles");
    for (const row of listAccounts()) {
      if (row?.accountId) ids.add(row.accountId);
    }
  } catch {
    /* ignore */
  }
  return [...ids];
}

load();

module.exports = {
  load,
  save,
  areFriends,
  listFriends,
  listIncoming,
  listOutgoing,
  listBlocked,
  registerAccount,
  sendRequest,
  acceptRequest,
  removeFriend,
  addFriendship,
  accountIdsForDiscovery,
};
