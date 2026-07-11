// In-memory player activity for Discord Rich Presence / panel queries.
const states = new Map();

/** @typedef {'offline'|'online'|'matchmaking'|'in_match'} PresenceState */

/**
 * @param {string} accountId
 * @param {PresenceState} state
 * @param {string} [detail]
 */
function setPresence(accountId, state, detail = "") {
  if (!accountId) return;
  states.set(accountId, { state, detail, updatedAt: Date.now() });
}

/** @param {string} accountId */
function getPresence(accountId) {
  if (!accountId) return { state: "offline", detail: "", updatedAt: 0 };
  return states.get(accountId) || { state: "offline", detail: "", updatedAt: 0 };
}

/** @param {string} accountId */
function clearPresence(accountId) {
  if (!accountId) return;
  states.delete(accountId);
}

/** Mark XMPP connection as online (lobby) unless already in matchmaking / in_match. */
function setOnline(accountId, displayName = "") {
  if (!accountId) return;
  const cur = getPresence(accountId);
  if (cur.state === "matchmaking" || cur.state === "in_match") return;
  setPresence(accountId, "online", displayName);
}

module.exports = { setPresence, getPresence, clearPresence, setOnline, states };
