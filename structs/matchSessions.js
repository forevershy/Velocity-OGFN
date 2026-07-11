const crypto = require("crypto");

/** @type {Map<string, object>} */
const sessions = new Map();

/** @type {Map<string, object>} */
const accountContext = new Map();

let lastQueuedAccount = null;

function setLastQueuedAccount(accountId) {
  lastQueuedAccount = accountId;
}

function getLastQueuedAccount() {
  return lastQueuedAccount;
}

function makeId(seed) {
  return crypto.createHash("md5").update(`${seed}:${Date.now()}:${Math.random()}`).digest("hex");
}

function setAccountContext(accountId, ctx) {
  accountContext.set(accountId, { ...accountContext.get(accountId), ...ctx, updatedAt: Date.now() });
}

function getAccountContext(accountId) {
  return accountContext.get(accountId) || {};
}

function createSession({ sessionId, accountId, matchId, playlist, region, buildUniqueId, ownerId, sessionKey }) {
  const id = sessionId || makeId("session");
  const session = {
    id,
    matchId: matchId || makeId("match"),
    accountId: accountId || null,
    playlist: playlist || "Playlist_DefaultSolo",
    region: region || "NAE",
    buildUniqueId: buildUniqueId || "0",
    ownerId: ownerId || null,
    sessionKey: sessionKey || null,
    createdAt: Date.now(),
  };
  sessions.set(id, session);
  return session;
}

function getSession(sessionId) {
  return sessions.get(sessionId) || null;
}

function touchSession(sessionId, patch) {
  const session = sessions.get(sessionId);
  if (!session) return null;
  Object.assign(session, patch);
  sessions.set(sessionId, session);
  return session;
}

module.exports = {
  sessions,
  accountContext,
  makeId,
  setAccountContext,
  getAccountContext,
  setLastQueuedAccount,
  getLastQueuedAccount,
  createSession,
  getSession,
  touchSession,
};
