const express = require("express");
const app = express.Router();

const {
  friendPublic,
  friendV1,
  incomingRequests,
  outgoingRequests,
  blocklist,
  searchAccounts,
  resolveAccountId,
  ensureFriendProfiles,
} = require("../structs/friends");
const {
  sendRequest,
  acceptRequest,
  removeFriend,
  addFriendship,
  registerAccount,
  listIncoming,
} = require("../structs/friendGraph");
const { pushFriendPending, pushFriendAccepted, pushFriendRemoved } = require("../structs/socialNotify");
const { displayNameFor } = require("../utils/accounts");
const log = require("../utils/logger");

function autoAcceptFriends() {
  try {
    const config = require("../config/config.json");
    return config.bAutoAcceptFriends !== false;
  } catch {
    return true;
  }
}

function friendIdFromRequest(req) {
  return resolveAccountId(
    req.params.friendId ||
      req.params.receiverId ||
      req.body?.accountId ||
      req.body?.friendId ||
      req.body?.receiverId
  );
}

function prepareAccounts(fromId, toId) {
  if (!fromId || !toId || fromId === toId) return false;
  registerAccount(fromId);
  registerAccount(toId);
  ensureFriendProfiles(fromId);
  ensureFriendProfiles(toId);
  return true;
}

function handleAddFriend(fromId, toId, res) {
  if (!prepareAccounts(fromId, toId)) return res.status(400).end();

  if (autoAcceptFriends()) {
    addFriendship(fromId, toId);
    pushFriendAccepted(fromId, toId);
    log.backend(`Friends auto-accepted ${fromId.slice(0, 8)} <-> ${toId.slice(0, 8)}`);
    return res.status(204).end();
  }

  if (listIncoming(fromId).includes(toId)) {
    acceptRequest(fromId, toId);
    pushFriendAccepted(fromId, toId);
    log.backend(`Friends accepted ${fromId.slice(0, 8)} <-> ${toId.slice(0, 8)}`);
    return res.status(204).end();
  }

  const result = sendRequest(fromId, toId);
  if (result.status === "accepted") {
    pushFriendAccepted(fromId, toId);
    log.backend(`Friends accepted ${fromId.slice(0, 8)} <-> ${toId.slice(0, 8)}`);
  } else if (result.status === "sent") {
    pushFriendPending(fromId, toId);
    log.backend(`Friend request ${fromId.slice(0, 8)} -> ${toId.slice(0, 8)}`);
  }
  return res.status(204).end();
}

function handleRemoveFriend(fromId, toId, res) {
  if (!fromId || !toId) return res.status(400).end();
  removeFriend(fromId, toId);
  pushFriendRemoved(fromId, toId);
  return res.status(204).end();
}

app.get("/friends/api/public/friends/:accountId", (req, res) => res.json(friendPublic(req.params.accountId)));

app.get("/friends/api/public/list/fortnite/:accountId/recentPlayers", (req, res) =>
  res.json(friendPublic(req.params.accountId).filter((f) => f.status === "ACCEPTED"))
);

app.get("/friends/api/v1/:accountId/summary", (req, res) =>
  res.json({
    friends: friendV1(req.params.accountId),
    incoming: incomingRequests(req.params.accountId),
    outgoing: outgoingRequests(req.params.accountId),
    suggested: [],
    blocklist: blocklist(req.params.accountId),
    settings: { acceptInvites: "public" },
  })
);

app.get("/friends/api/v1/:accountId/blocklist", (req, res) => res.json(blocklist(req.params.accountId)));
app.get("/friends/api/public/blocklist/:accountId", (req, res) =>
  res.json({ blockedUsers: blocklist(req.params.accountId).map((b) => b.accountId) })
);
app.get("/friends/api/v1/:accountId/friends", (req, res) => res.json(friendV1(req.params.accountId)));
app.get("/friends/api/v1/:accountId/settings", (req, res) => res.json({ acceptInvites: "public" }));

app.get("/friends/api/v1/:accountId/incoming", (req, res) => res.json(incomingRequests(req.params.accountId)));
app.get("/friends/api/v1/:accountId/outgoing", (req, res) => res.json(outgoingRequests(req.params.accountId)));

const addFriendHandler = (req, res) => {
  const fromId = resolveAccountId(req.params.accountId);
  const toId = friendIdFromRequest(req);
  return handleAddFriend(fromId, toId, res);
};

const removeFriendHandler = (req, res) => {
  const fromId = resolveAccountId(req.params.accountId);
  const toId = friendIdFromRequest(req);
  return handleRemoveFriend(fromId, toId, res);
};

app.post("/friends/api/v1/:accountId/friends/:friendId", addFriendHandler);
app.post("/friends/api/public/friends/:accountId/:friendId", addFriendHandler);
app.post("/friends/api/:accountId/friends/:friendId", addFriendHandler);

app.delete("/friends/api/v1/:accountId/friends/:friendId", removeFriendHandler);
app.delete("/friends/api/public/friends/:accountId/:friendId", removeFriendHandler);
app.delete("/friends/api/:accountId/friends/:friendId", removeFriendHandler);

app.post("/friends/api/v1/:accountId/incoming/:friendId/accept", (req, res) => {
  const accountId = resolveAccountId(req.params.accountId);
  const friendId = resolveAccountId(req.params.friendId);
  if (!prepareAccounts(accountId, friendId)) return res.status(400).end();
  const result = acceptRequest(accountId, friendId);
  if (result.ok) pushFriendAccepted(friendId, accountId);
  return res.status(204).end();
});

app.get("/friends/api/v1/:accountId/search", (req, res) => {
  const q = req.query.displayName || req.query.q || req.query.username || "";
  const results = searchAccounts(q, resolveAccountId(req.params.accountId));
  res.json(
    results.map((row) => ({
      accountId: row.accountId,
      displayName: row.displayName,
      matches: [{ accountId: row.accountId, displayName: row.displayName }],
    }))
  );
});

app.get("/friends/api/public/search/:accountId", (req, res) => {
  const q = req.query.displayName || req.query.q || req.query.username || "";
  const results = searchAccounts(q, resolveAccountId(req.params.accountId));
  res.json(
    results.map((row) => ({
      accountId: row.accountId,
      displayName: row.displayName,
    }))
  );
});

app.get("/friends/api/v1/:accountId/friends/:friendId", (req, res) => {
  const friendId = resolveAccountId(req.params.friendId);
  res.json({
    accountId: friendId,
    groups: [],
    mutual: 0,
    alias: "",
    note: "",
    favorite: false,
    created: new Date().toISOString(),
    displayName: displayNameFor(friendId),
  });
});

module.exports = app;
