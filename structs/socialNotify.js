const { displayNameFor } = require("../utils/accounts");
const { nowIso } = require("../utils/functions");

const PARTY_NOTIFY = "com.epicgames.social.party.notification.v0";
const FRIEND_NOTIFY = "com.epicgames.social.friends.notification.v1";

function sendJsonToAccount(accountId, body) {
  const { sendXmppMessageToId } = require("../xmpp/xmpp");
  return sendXmppMessageToId(body, accountId);
}

function notifyParty(accountId, subType, payload) {
  return sendJsonToAccount(accountId, {
    type: `${PARTY_NOTIFY}.${subType}`,
    payload,
    timestamp: nowIso(),
  });
}

function notifyFriend(accountId, subType, payload) {
  return sendJsonToAccount(accountId, {
    type: `${FRIEND_NOTIFY}.${subType}`,
    payload,
    timestamp: nowIso(),
  });
}

function partyInvitePayload(party, invite) {
  return {
    party_id: party.id,
    party_type_id: "Fortnite",
    sender_id: invite.inviter_id,
    sender_display_name: displayNameFor(invite.inviter_id),
    sent_at: invite.sent_at,
    meta: invite.meta || {},
    invites: party.invites || [],
    members: party.members || [],
    revision: party.revision,
    config: party.config,
  };
}

function partyMemberPayload(party, memberId, subType) {
  return {
    party_id: party.id,
    party_type_id: "Fortnite",
    account_id: memberId,
    account_dn: displayNameFor(memberId),
    members: party.members,
    revision: party.revision,
    config: party.config,
    meta: party.meta || {},
    type: subType,
  };
}

function pushPartyInvite(party, invite) {
  const payload = partyInvitePayload(party, invite);
  notifyParty(invite.invitee_id, "INVITE", payload);
  notifyParty(invite.invitee_id, "INVITE_SENT", payload);
}

function pushPartyMemberJoined(party, memberId) {
  for (const member of party.members) {
    notifyParty(member.account_id, "MEMBER_JOINED", partyMemberPayload(party, memberId, "MEMBER_JOINED"));
  }
}

function pushPartyMemberLeft(party, memberId) {
  for (const member of party.members) {
    notifyParty(member.account_id, "MEMBER_LEFT", partyMemberPayload(party, memberId, "MEMBER_LEFT"));
  }
}

function pushPartyUpdated(party) {
  for (const member of party.members) {
    notifyParty(member.account_id, "PARTY_UPDATED", {
      party_id: party.id,
      members: party.members,
      revision: party.revision,
      config: party.config,
      meta: party.meta || {},
    });
  }
}

function pushFriendRequest(fromId, toId) {
  notifyFriend(toId, "FRIENDSHIP_REQUEST", {
    fromId,
    fromDisplayName: displayNameFor(fromId),
    created: nowIso(),
  });
}

function pushFriendAccepted(fromId, toId) {
  for (const id of [fromId, toId]) {
    notifyFriend(id, "FRIENDSHIP_ACCEPTED", {
      accountId: id === fromId ? toId : fromId,
      displayName: displayNameFor(id === fromId ? toId : fromId),
      created: nowIso(),
    });
  }
}

function buildJoinablePresence(party, displayName) {
  const size = party?.members?.length || 1;
  const max = party?.config?.max_size || 16;
  return {
    Status: "Playing Fortnite",
    bIsPlaying: true,
    bIsJoinable: true,
    bHasVoice: false,
    Properties: {
      InParty_s: "true",
      PartyIsJoinable_s: "true",
      PartySize_s: String(size),
      FortnitePartySize_s: String(size),
      FortnitePartyMaxSize_s: String(max),
      FortniteSubGame_s: "BattleRoyale",
      "party.joininfo.partyId": party?.id || "",
      PartyId_s: party?.id || "",
      "party.joininfo.platform_s": "WIN",
      "party.joininfo.sourceId_s": "Fortnite",
    },
  };
}

function pushPresenceToFriends(accountId, party) {
  const { findByAccountId, sendRaw } = require("../xmpp/xmpp");
  const { listFriends } = require("./friendGraph");
  const xmlbuilder = require("xmlbuilder");

  const client = findByAccountId(accountId);
  if (!client?.jid) return;

  const status = buildJoinablePresence(party, client.displayName || displayNameFor(accountId));
  const statusJson = JSON.stringify(status);
  const friends = listFriends(accountId);

  for (const friendId of friends) {
    const friend = findByAccountId(friendId);
    if (!friend?.jid) continue;
    const xml = xmlbuilder
      .create("presence")
      .attribute("from", client.jid)
      .attribute("to", friend.jid)
      .attribute("xmlns", "jabber:client")
      .element("status", statusJson)
      .up()
      .toString();
    sendRaw(friend, xml);
  }
}

module.exports = {
  notifyParty,
  notifyFriend,
  pushPartyInvite,
  pushPartyMemberJoined,
  pushPartyMemberLeft,
  pushPartyUpdated,
  pushFriendRequest,
  pushFriendAccepted,
  pushPresenceToFriends,
  buildJoinablePresence,
};
