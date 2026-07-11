const express = require("express");
const app = express.Router();

const { friendPublic, friendV1 } = require("../structs/friends");

function isOnline(accountId) {
  const { clients } = require("../xmpp/xmpp");
  for (const [, c] of clients) {
    if (c.accountId === accountId) return true;
  }
  return false;
}

// Auto-friend every known account so party invites and friend search work.
app.get("/friends/api/public/friends/:accountId", (req, res) =>
  res.json(
    friendPublic(req.params.accountId).map((f) => ({
      ...f,
      status: isOnline(f.accountId) ? "ONLINE" : "OFFLINE",
    }))
  )
);
app.get("/friends/api/public/list/fortnite/:accountId/recentPlayers", (req, res) =>
  res.json(friendPublic(req.params.accountId))
);
app.get("/friends/api/v1/:accountId/summary", (req, res) =>
  res.json({
    friends: friendV1(req.params.accountId),
    incoming: [],
    outgoing: [],
    suggested: [],
    blocklist: [],
    settings: { acceptInvites: "public" },
  })
);
app.get("/friends/api/v1/:accountId/blocklist", (req, res) => res.json([]));
app.get("/friends/api/public/blocklist/:accountId", (req, res) => res.json({ blockedUsers: [] }));
app.get("/friends/api/v1/:accountId/friends", (req, res) => res.json(friendV1(req.params.accountId)));
app.get("/friends/api/v1/:accountId/settings", (req, res) => res.json({ acceptInvites: "public" }));

app.post("/friends/api/v1/:accountId/friends/:friendId", (req, res) => res.status(204).end());
app.delete("/friends/api/v1/:accountId/friends/:friendId", (req, res) => res.status(204).end());
app.post("/friends/api/public/friends/:accountId/:friendId", (req, res) => res.status(204).end());
app.delete("/friends/api/public/friends/:accountId/:friendId", (req, res) => res.status(204).end());

module.exports = app;
