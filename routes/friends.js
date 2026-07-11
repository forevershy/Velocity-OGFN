const express = require("express");
const app = express.Router();

const {
  friendPublic,
  friendV1,
  incomingRequests,
  outgoingRequests,
  displayNameFor,
} = require("../structs/friends");
const {
  sendRequest,
  acceptRequest,
  removeFriend,
  addFriendship,
} = require("../structs/friendGraph");
const { pushFriendRequest, pushFriendAccepted } = require("../structs/socialNotify");
const { isAccountOnline } = require("../utils/accounts");
const { accountIdFromName } = require("../utils/functions");

function autoAcceptFriends() {
  try {
    const config = require("../config/config.json");
    return config.bAutoAcceptFriends !== false;
  } catch {
    return true;
  }
}

function handleAddFriend(fromId, toId, res) {
  if (!fromId || !toId || fromId === toId) return res.status(400).end();

  if (autoAcceptFriends()) {
    addFriendship(fromId, toId);
    pushFriendAccepted(fromId, toId);
    return res.status(204).end();
  }

  const result = sendRequest(fromId, toId);
  if (result.status === "accepted") {
    pushFriendAccepted(fromId, toId);
  } else if (result.status === "sent") {
    pushFriendRequest(fromId, toId);
  }
  return res.status(204).end();
}

app.get("/friends/api/public/friends/:accountId", (req, res) =>
  res.json(
    friendPublic(req.params.accountId).map((f) => ({
      ...f,
      status: isAccountOnline(f.accountId) ? "ONLINE" : "OFFLINE",
    }))
  )
);

app.get("/friends/api/public/list/fortnite/:accountId/recentPlayers", (req, res) =>
  res.json(friendPublic(req.params.accountId))
);

app.get("/friends/api/v1/:accountId/summary", (req, res) =>
  res.json({
    friends: friendV1(req.params.accountId),
    incoming: incomingRequests(req.params.accountId),
    outgoing: outgoingRequests(req.params.accountId),
    suggested: [],
    blocklist: [],
    settings: { acceptInvites: "public" },
  })
);

app.get("/friends/api/v1/:accountId/blocklist", (req, res) => res.json([]));
app.get("/friends/api/public/blocklist/:accountId", (req, res) => res.json({ blockedUsers: [] }));
app.get("/friends/api/v1/:accountId/friends", (req, res) => res.json(friendV1(req.params.accountId)));
app.get("/friends/api/v1/:accountId/settings", (req, res) => res.json({ acceptInvites: "public" }));

app.post("/friends/api/v1/:accountId/friends/:friendId", (req, res) =>
  handleAddFriend(req.params.accountId, req.params.friendId, res)
);

app.post("/friends/api/public/friends/:accountId/:friendId", (req, res) =>
  handleAddFriend(req.params.accountId, req.params.friendId, res)
);

app.delete("/friends/api/v1/:accountId/friends/:friendId", (req, res) => {
  removeFriend(req.params.accountId, req.params.friendId);
  res.status(204).end();
});

app.delete("/friends/api/public/friends/:accountId/:friendId", (req, res) => {
  removeFriend(req.params.accountId, req.params.friendId);
  res.status(204).end();
});

// Accept incoming request (some builds POST here with friend id in body).
app.post("/friends/api/v1/:accountId/incoming/:friendId/accept", (req, res) => {
  const result = acceptRequest(req.params.accountId, req.params.friendId);
  if (result.ok) pushFriendAccepted(req.params.friendId, req.params.accountId);
  res.status(204).end();
});

// Search / add by display name (launcher panel or in-game search).
app.get("/friends/api/v1/:accountId/search", (req, res) => {
  const q = String(req.query.displayName || req.query.q || "").trim().toLowerCase();
  if (!q) return res.json([]);
  const accountId = accountIdFromName(q);
  res.json([
    {
      accountId,
      displayName: displayNameFor(accountId),
      matches: [{ accountId, displayName: displayNameFor(accountId) }],
    },
  ]);
});

module.exports = app;
