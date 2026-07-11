// Shared friends list — every known account is auto-friended so party invites work.
const { sessions } = require("../routes/auth");
const { listAccounts } = require("./profiles");
const { clients } = require("../xmpp/xmpp");

function displayNameFor(accountId) {
  const session = sessions.get(accountId);
  if (session?.displayName) return session.displayName;
  for (const [, c] of clients) {
    if (c.accountId === accountId && c.displayName) return c.displayName;
  }
  return `Player_${String(accountId).slice(0, 6)}`;
}

function collectAccountIds() {
  const ids = new Set();
  for (const row of listAccounts()) {
    if (row?.accountId) ids.add(row.accountId);
  }
  for (const accountId of sessions.keys()) ids.add(accountId);
  for (const [, c] of clients) {
    if (c.accountId) ids.add(c.accountId);
  }
  return [...ids];
}

function friendSummary(forAccountId) {
  return collectAccountIds()
    .filter((id) => id !== forAccountId)
    .map((accountId) => ({
      accountId,
      groups: [],
      alias: "",
      note: "",
      favorite: false,
      created: new Date().toISOString(),
    }));
}

function friendPublic(forAccountId) {
  return collectAccountIds()
    .filter((id) => id !== forAccountId)
    .map((accountId) => ({
      accountId,
      status: clients.has(`${accountId}@prod.ol.epicgames.com`) ? "ONLINE" : "OFFLINE",
      created: new Date().toISOString(),
    }));
}

function friendV1(forAccountId) {
  return collectAccountIds()
    .filter((id) => id !== forAccountId)
    .map((accountId) => ({
      accountId,
      groups: [],
      alias: "",
      note: "",
      favorite: false,
      created: new Date().toISOString(),
    }));
}

module.exports = { collectAccountIds, displayNameFor, friendSummary, friendPublic, friendV1 };
