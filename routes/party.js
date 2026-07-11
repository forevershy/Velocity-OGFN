const express = require("express");
const app = express.Router();

const {
  partyPayload,
  createParty,
  getParty,
  getUserParty,
  addMember,
  removeMember,
  addInvite,
  listUserInvites,
  listUserCurrent,
  updateParty,
} = require("../structs/partyService");

app.get("/party/api/v1/Fortnite/user/:accountId", (req, res) => {
  res.json({
    current: listUserCurrent(req.params.accountId),
    pending: [],
    invites: listUserInvites(req.params.accountId),
    pings: [],
  });
});

app.get("/party/api/v1/Fortnite/parties/:partyId", (req, res) => {
  const party = getParty(req.params.partyId);
  if (!party) return res.status(404).end();
  res.json(partyPayload(party));
});

app.post("/party/api/v1/Fortnite/parties", (req, res) => {
  const captainId = req.body?.join_info?.connection?.id || req.body?.join_info?.account_id;
  const existing = captainId ? getUserParty(captainId) : null;
  if (existing) return res.json(partyPayload(existing));
  const party = createParty(captainId, req.body || {});
  res.json(partyPayload(party));
});

app.patch("/party/api/v1/Fortnite/parties/:partyId", (req, res) => {
  const party = getParty(req.params.partyId);
  if (!party) return res.status(404).end();
  updateParty(party, req.body || {});
  res.status(204).end();
});

app.post("/party/api/v1/Fortnite/parties/:partyId/members/:accountId/join", (req, res) => {
  const party = getParty(req.params.partyId);
  if (!party) return res.status(404).end();
  addMember(party, req.params.accountId, "MEMBER");
  res.status(204).end();
});

app.post("/party/api/v1/Fortnite/parties/:partyId/members/:accountId/invite", (req, res) => {
  const party = getParty(req.params.partyId);
  if (!party) return res.status(404).end();
  const inviteeId = req.body?.invitee_id || req.params.accountId;
  addInvite(party, req.params.accountId, inviteeId, req.body?.meta || {});
  res.status(204).end();
});

app.post("/party/api/v1/Fortnite/parties/:partyId/members/:accountId/kick", (req, res) => {
  const party = getParty(req.params.partyId);
  if (!party) return res.status(404).end();
  removeMember(party, req.params.accountId);
  res.status(204).end();
});

app.post("/party/api/v1/Fortnite/parties/:partyId/members/:accountId/confirm", (req, res) => {
  const party = getParty(req.params.partyId);
  if (!party) return res.status(404).end();
  addMember(party, req.params.accountId, "MEMBER");
  res.status(204).end();
});

app.post("/party/api/v1/Fortnite/parties/:partyId/members/:accountId/meta", (req, res) => {
  const party = getParty(req.params.partyId);
  if (!party) return res.status(404).end();
  const row = party.members.find((m) => m.account_id === req.params.accountId);
  if (row) row.meta = { ...row.meta, ...(req.body || {}) };
  party.revision += 1;
  res.status(204).end();
});

app.post("/party/api/v1/Fortnite/parties/:partyId/members/:accountId/:action", (req, res) => {
  const party = getParty(req.params.partyId);
  if (!party) return res.status(404).end();
  const action = String(req.params.action || "").toLowerCase();
  if (action === "join" || action === "confirm") {
    addMember(party, req.params.accountId, "MEMBER");
  }
  res.status(204).end();
});

app.delete("/party/api/v1/Fortnite/parties/:partyId/members/:accountId", (req, res) => {
  const party = getParty(req.params.partyId);
  if (!party) return res.status(404).end();
  removeMember(party, req.params.accountId);
  res.status(204).end();
});

app.post("/party/api/v1/Fortnite/user/:accountId/pings/:pingerId", (req, res) => {
  const { notifyParty } = require("../structs/socialNotify");
  const { displayNameFor } = require("../structs/friends");
  notifyParty(req.params.accountId, "PING", {
    pinger_id: req.params.pingerId,
    pinger_display_name: displayNameFor(req.params.pingerId),
    sent_at: new Date().toISOString(),
  });
  res.status(204).end();
});

module.exports = app;
