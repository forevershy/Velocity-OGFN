const express = require("express");
const app = express.Router();

const { nowIso } = require("../utils/functions");
const { displayNameFor } = require("../structs/friends");

// In-memory party state so invites and joins persist across HTTP calls.
const parties = new Map();
const userParty = new Map();

function memberRow(accountId, role = "CAPTAIN") {
  return {
    account_id: accountId,
    meta: { dn: displayNameFor(accountId) },
    role,
    joined_at: nowIso(),
    updated_at: nowIso(),
    revision: 0,
  };
}

function partyPayload(party) {
  return {
    id: party.id,
    created_at: party.created_at,
    updated_at: party.updated_at,
    config: party.config,
    members: party.members,
    applicants: [],
    meta: party.meta,
    invites: [],
    revision: party.revision,
    intentions: [],
  };
}

app.get("/party/api/v1/Fortnite/user/:accountId", (req, res) => {
  const accountId = req.params.accountId;
  const partyId = userParty.get(accountId);
  const current = [];
  const invites = [];

  if (partyId && parties.has(partyId)) {
    current.push({ id: partyId, role: "CAPTAIN", joined_at: parties.get(partyId).created_at, updated_at: nowIso() });
  }

  for (const [, party] of parties) {
    for (const inv of party.invites || []) {
      if (inv.invitee_id === accountId) invites.push(inv);
    }
  }

  res.json({ current, pending: [], invites, pings: [] });
});

app.post("/party/api/v1/Fortnite/parties", (req, res) => {
  const captainId = req.body?.join_info?.connection?.id || req.body?.join_info?.account_id;
  const partyId = require("crypto").randomBytes(16).toString("hex");
  const party = {
    id: partyId,
    created_at: nowIso(),
    updated_at: nowIso(),
    config: req.body?.config || { type: "DEFAULT", joinability: "OPEN", discoverability: "ALL", sub_type: "default", max_size: 16, invite_ttl: 14400 },
    members: captainId ? [memberRow(captainId, "CAPTAIN")] : [],
    meta: req.body?.meta || {},
    invites: [],
    revision: 0,
  };
  parties.set(partyId, party);
  if (captainId) userParty.set(captainId, partyId);
  res.json(partyPayload(party));
});

app.patch("/party/api/v1/Fortnite/parties/:partyId", (req, res) => {
  const party = parties.get(req.params.partyId);
  if (!party) return res.status(404).end();
  party.updated_at = nowIso();
  party.revision += 1;
  if (req.body?.config) party.config = { ...party.config, ...req.body.config };
  if (req.body?.meta) party.meta = { ...party.meta, ...req.body.meta };
  res.status(204).end();
});

app.post("/party/api/v1/Fortnite/parties/:partyId/members/:accountId/join", (req, res) => {
  const party = parties.get(req.params.partyId);
  if (!party) return res.status(404).end();
  const accountId = req.params.accountId;
  if (!party.members.find((m) => m.account_id === accountId)) {
    party.members.push(memberRow(accountId, "MEMBER"));
  }
  userParty.set(accountId, party.id);
  party.updated_at = nowIso();
  party.revision += 1;
  res.status(204).end();
});

app.post("/party/api/v1/Fortnite/parties/:partyId/members/:accountId/invite", (req, res) => {
  const party = parties.get(req.params.partyId);
  if (!party) return res.status(404).end();
  const inviteeId = req.body?.invitee_id || req.params.accountId;
  party.invites = party.invites || [];
  party.invites.push({
    party_id: party.id,
    inviter_id: req.params.accountId,
    invitee_id: inviteeId,
    sent_at: nowIso(),
    updated_at: nowIso(),
    meta: req.body?.meta || {},
    status: "SENT",
  });
  party.updated_at = nowIso();
  res.status(204).end();
});

app.post("/party/api/v1/Fortnite/parties/:partyId/members/:accountId/*", (req, res) => res.status(204).end());
app.delete("/party/api/v1/Fortnite/parties/:partyId/members/:accountId", (req, res) => {
  const party = parties.get(req.params.partyId);
  if (!party) return res.status(404).end();
  const accountId = req.params.accountId;
  party.members = party.members.filter((m) => m.account_id !== accountId);
  if (userParty.get(accountId) === party.id) userParty.delete(accountId);
  if (party.members.length === 0) parties.delete(party.id);
  res.status(204).end();
});
app.post("/party/api/v1/Fortnite/user/:accountId/pings/:pingerId", (req, res) => res.status(204).end());

module.exports = app;
