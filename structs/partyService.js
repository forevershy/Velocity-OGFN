const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { nowIso } = require("../utils/functions");
const { displayNameFor } = require("../utils/accounts");
const {
  pushPartyInvite,
  pushPartyMemberJoined,
  pushPartyMemberLeft,
  pushPartyUpdated,
  pushPresenceToFriends,
} = require("./socialNotify");

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

function inviteRow(party, inviterId, inviteeId, meta = {}) {
  return {
    party_id: party.id,
    inviter_id: inviterId,
    invitee_id: inviteeId,
    sent_at: nowIso(),
    updated_at: nowIso(),
    meta,
    status: "SENT",
  };
}

function partyPayload(party, { includeInvites = true } = {}) {
  return {
    id: party.id,
    created_at: party.created_at,
    updated_at: party.updated_at,
    config: party.config,
    members: party.members,
    applicants: [],
    meta: party.meta,
    invites: includeInvites ? party.invites || [] : [],
    revision: party.revision,
    intentions: [],
  };
}

function defaultConfig(overrides = {}) {
  return {
    type: "DEFAULT",
    joinability: "OPEN",
    discoverability: "ALL",
    sub_type: "default",
    max_size: 16,
    invite_ttl: 14400,
    ...overrides,
  };
}

function defaultMeta(partyId) {
  return {
    "urn:epic:cfg:party-type-id_s": "default",
    "urn:epic:cfg:joinability_s": "OPEN",
    "urn:epic:cfg:discoverability_s": "ALL",
    "urn:epic:cfg:accepting-members_b": "true",
    "urn:epic:cfg:party-id_s": partyId,
  };
}

function createParty(captainId, body = {}) {
  const partyId = crypto.randomBytes(16).toString("hex");
  const party = {
    id: partyId,
    created_at: nowIso(),
    updated_at: nowIso(),
    config: defaultConfig(body.config),
    members: captainId ? [memberRow(captainId, "CAPTAIN")] : [],
    meta: { ...defaultMeta(partyId), ...(body.meta || {}) },
    invites: [],
    revision: 0,
  };
  parties.set(partyId, party);
  if (captainId) userParty.set(captainId, partyId);
  return party;
}

function getParty(partyId) {
  return parties.get(partyId) || null;
}

function getUserPartyId(accountId) {
  return userParty.get(accountId) || null;
}

function getUserParty(accountId) {
  const id = userParty.get(accountId);
  return id ? parties.get(id) : null;
}

function memberRole(party, accountId) {
  const row = party.members.find((m) => m.account_id === accountId);
  return row?.role || "MEMBER";
}

function addMember(party, accountId, role = "MEMBER") {
  if (!party.members.find((m) => m.account_id === accountId)) {
    party.members.push(memberRow(accountId, role));
  } else {
    const row = party.members.find((m) => m.account_id === accountId);
    row.meta.dn = displayNameFor(accountId);
    row.updated_at = nowIso();
  }
  party.invites = (party.invites || []).filter((inv) => inv.invitee_id !== accountId);
  userParty.set(accountId, party.id);
  party.updated_at = nowIso();
  party.revision += 1;
  pushPartyMemberJoined(party, accountId);
  pushPartyUpdated(party);
  for (const member of party.members) {
    pushPresenceToFriends(member.account_id, party);
  }
  return party;
}

function removeMember(party, accountId) {
  party.members = party.members.filter((m) => m.account_id !== accountId);
  if (userParty.get(accountId) === party.id) userParty.delete(accountId);
  party.updated_at = nowIso();
  party.revision += 1;
  pushPartyMemberLeft(party, accountId);
  if (party.members.length === 0) {
    parties.delete(party.id);
    return null;
  }
  if (!party.members.some((m) => m.role === "CAPTAIN")) {
    party.members[0].role = "CAPTAIN";
  }
  pushPartyUpdated(party);
  for (const member of party.members) {
    pushPresenceToFriends(member.account_id, party);
  }
  return party;
}

function addInvite(party, inviterId, inviteeId, meta = {}) {
  party.invites = party.invites || [];
  party.invites = party.invites.filter((inv) => inv.invitee_id !== inviteeId);
  const invite = inviteRow(party, inviterId, inviteeId, meta);
  party.invites.push(invite);
  party.updated_at = nowIso();
  party.revision += 1;
  pushPartyInvite(party, invite);
  return invite;
}

function listUserInvites(accountId) {
  const invites = [];
  for (const [, party] of parties) {
    for (const inv of party.invites || []) {
      if (inv.invitee_id === accountId) invites.push(inv);
    }
  }
  return invites;
}

function listUserCurrent(accountId) {
  const partyId = userParty.get(accountId);
  if (!partyId || !parties.has(partyId)) return [];
  const party = parties.get(partyId);
  return [
    {
      id: partyId,
      role: memberRole(party, accountId),
      joined_at: party.members.find((m) => m.account_id === accountId)?.joined_at || party.created_at,
      updated_at: nowIso(),
    },
  ];
}

function updateParty(party, patch = {}) {
  if (patch.config) party.config = { ...party.config, ...patch.config };
  if (patch.meta) party.meta = { ...party.meta, ...patch.meta };
  party.updated_at = nowIso();
  party.revision += 1;
  pushPartyUpdated(party);
  for (const member of party.members) {
    pushPresenceToFriends(member.account_id, party);
  }
  return party;
}

module.exports = {
  parties,
  userParty,
  memberRow,
  partyPayload,
  createParty,
  getParty,
  getUserParty,
  getUserPartyId,
  addMember,
  removeMember,
  addInvite,
  listUserInvites,
  listUserCurrent,
  updateParty,
  memberRole,
};
