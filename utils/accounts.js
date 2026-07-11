const { formatOwnerDisplayName, stripOwnerTag, isOwnerAccount, getOwnerConfig } = require("../structs/owner");

function sessionsMap() {
  return require("../routes/auth").sessions;
}

function refreshXmppDisplayName(accountId, displayName) {
  try {
    const { findByAccountId } = require("../xmpp/xmpp");
    const client = findByAccountId(accountId);
    if (client && displayName) client.displayName = displayName;
  } catch {
    /* xmpp not ready */
  }
}

function usernameForAccountId(accountId) {
  const id = String(accountId || "").toLowerCase();
  const owner = getOwnerConfig();
  if (owner.accountId && id === String(owner.accountId).toLowerCase() && owner.username) {
    return owner.username;
  }

  const session = sessionsMap().get(accountId);
  if (session?.username) return stripOwnerTag(session.username);
  if (session?.displayName) return stripOwnerTag(session.displayName);
  return null;
}

function resolveDisplayName(accountId, usernameHint) {
  const id = String(accountId || "");
  const username = stripOwnerTag(usernameHint || "") || usernameForAccountId(id);
  if (!username) {
    return sessionsMap().get(id)?.displayName || `Player_${id.slice(0, 6)}`;
  }
  return formatOwnerDisplayName(username);
}

function ensureSessionDisplayName(accountId, usernameHint) {
  const id = String(accountId || "");
  const username = stripOwnerTag(usernameHint || "") || usernameForAccountId(id);
  const displayName = username ? formatOwnerDisplayName(username) : resolveDisplayName(id);
  sessionsMap().set(id, {
    displayName,
    username: username || stripOwnerTag(displayName),
  });
  refreshXmppDisplayName(id, displayName);
  return displayName;
}

function displayNameFor(accountId) {
  const id = String(accountId || "");
  const owner = getOwnerConfig();
  if (owner.accountId && id.toLowerCase() === String(owner.accountId).toLowerCase() && owner.username) {
    return formatOwnerDisplayName(owner.username);
  }

  const session = sessionsMap().get(id);
  if (session?.displayName) {
    const base = stripOwnerTag(session.displayName);
    if (isOwnerAccount(id, base)) return formatOwnerDisplayName(base);
    return session.displayName;
  }

  try {
    const { clients } = require("../xmpp/xmpp");
    for (const [, c] of clients) {
      if (c.accountId === id && c.displayName) {
        const base = stripOwnerTag(c.displayName);
        if (isOwnerAccount(id, base)) return formatOwnerDisplayName(base);
        return c.displayName;
      }
    }
  } catch {
    /* xmpp not ready */
  }

  return `Player_${id.slice(0, 6)}`;
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

module.exports = {
  displayNameFor,
  ensureSessionDisplayName,
  resolveDisplayName,
  isAccountOnline,
};
