const { sessions } = require("../routes/auth");

function displayNameFor(accountId) {
  const session = sessions.get(accountId);
  if (session?.displayName) return session.displayName;
  try {
    const { clients } = require("../xmpp/xmpp");
    for (const [, c] of clients) {
      if (c.accountId === accountId && c.displayName) return c.displayName;
    }
  } catch {
    /* xmpp not ready */
  }
  return `Player_${String(accountId).slice(0, 6)}`;
}

function isAccountOnline(accountId) {
  try {
    const { clients } = require("../xmpp/xmpp");
    for (const [, c] of clients) {
      if (c.accountId === accountId) return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

module.exports = { displayNameFor, isAccountOnline };
