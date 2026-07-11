const fs = require("fs");
const path = require("path");
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  PermissionFlagsBits,
  ActivityType,
} = require("discord.js");
const { OWNER_COMMANDS } = require("./commands");

const configPath = path.join(__dirname, "config.json");
if (!fs.existsSync(configPath)) {
  console.error("Missing config.json — copy config.example.json to config.json and fill it in.");
  process.exit(1);
}

const config = require("./config.json");
const API = `${String(config.backendUrl || "http://127.0.0.1:3551").replace(/\/$/, "")}/ogfn-panel/api`;

function isOwner(interaction) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  if (config.ownerUserIds?.includes(interaction.user.id)) return true;
  if (config.ownerRoleIds?.length && interaction.member?.roles?.cache) {
    return config.ownerRoleIds.some((roleId) => interaction.member.roles.cache.has(roleId));
  }
  return !config.ownerUserIds?.length && !config.ownerRoleIds?.length;
}

async function api(pathname, method = "GET", body) {
  const headers = { "Content-Type": "application/json" };
  if (config.panelToken) headers["X-Velocity-Token"] = config.panelToken;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const res = await fetch(`${API}${pathname}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await res.text();
    try {
      return { status: res.status, data: JSON.parse(text) };
    } catch {
      return { status: res.status, data: { ok: false, reason: text || res.statusText } };
    }
  } catch (err) {
    if (err.name === "AbortError") {
      return { status: 0, data: { ok: false, reason: "Backend timed out — is Velocity running?" } };
    }
    return {
      status: 0,
      data: { ok: false, reason: "Backend offline — start Velocity first, then try again." },
    };
  } finally {
    clearTimeout(timeout);
  }
}

function embed(title, description, color = 0x5865f2) {
  return new EmbedBuilder().setTitle(title).setDescription(description).setColor(color);
}

async function linkedUsername(discordUserId) {
  const { data } = await api(`/discord-link/${discordUserId}`);
  return data.username || null;
}

async function resolveUser(interaction, optionName) {
  const explicit = interaction.options.getString(optionName);
  if (explicit) return explicit.trim();
  return linkedUsername(interaction.user.id);
}

async function logAction(client, message) {
  if (!config.logChannelId) return;
  try {
    const channel = await client.channels.fetch(config.logChannelId);
    if (channel?.isTextBased()) await channel.send(message);
  } catch {
    /* ignore */
  }
}

function denyOwner(interaction) {
  return interaction.reply({
    content: "You don't have permission to use owner commands.",
    ephemeral: true,
  });
}

function fail(interaction, message, ephemeral = true) {
  const payload = { content: message, ephemeral };
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
  return interaction.reply(payload);
}

function respond(interaction, payload) {
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
  return interaction.reply(payload);
}

const EPHEMERAL_COMMANDS = new Set(["appeal", "claimvbucks"]);

const PRESENCE_INTERVAL_MS = 30_000;

async function updatePlayerPresence(client) {
  try {
    const { data } = await api("/status");
    const count = data.connectedXmpp ?? 0;
    if (count > 0) {
      const label = count === 1 ? "1 Player" : `${count} Players`;
      client.user.setPresence({
        activities: [{ name: label, type: ActivityType.Watching }],
        status: "online",
      });
    } else {
      client.user.setPresence({ activities: [], status: "online" });
    }
  } catch (err) {
    console.error("Failed to update presence:", err.message);
  }
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", () => {
  console.log(`Velocity bot online as ${client.user.tag}`);
  console.log(`Backend: ${API}`);
  updatePlayerPresence(client);
  setInterval(() => updatePlayerPresence(client), PRESENCE_INTERVAL_MS);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const cmd = interaction.commandName;
  if (OWNER_COMMANDS.has(cmd) && !isOwner(interaction)) return denyOwner(interaction);

  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ ephemeral: EPHEMERAL_COMMANDS.has(cmd) });
    }

    // ---- Player commands ----
    if (cmd === "create") {
      const username = interaction.options.getString("username", true);
      const { data } = await api("/create", "POST", {
        username,
        discordUserId: interaction.user.id,
      });
      if (!data.ok) return fail(interaction, data.reason || "Could not create account.");
      return respond(interaction, {
        embeds: [
          embed(
            "Account created",
            `**${username}** is ready to play.\nAccount ID: \`${data.accountId}\`\n\nUse this username in the Velocity launcher.`,
            0x37d67a
          ),
        ],
      });
    }

    if (cmd === "appeal") {
      const username = await resolveUser(interaction, "user");
      if (!username) {
        return fail(interaction, "Link an account first with `/create` or pass your username.");
      }
      const reason = interaction.options.getString("reason") || "Appeal submitted via Discord";
      const { data } = await api("/appeal", "POST", {
        username,
        discordUserId: interaction.user.id,
        reason,
      });
      if (!data.ok) return fail(interaction, data.reason || "Appeal failed.");
      await logAction(client, `📩 Ban appeal from **${username}** (${interaction.user.tag})`);
      return respond(interaction, {
        embeds: [
          embed(
            "Appeal submitted",
            "Your ban appeal was sent to server staff. You will be notified if it is approved.",
            0xfaa61a
          ),
        ],
        ephemeral: true,
      });
    }

    if (cmd === "buy") {
      const item = interaction.options.getString("item", true);
      const user = await resolveUser(interaction, "user");
      if (!user) return fail(interaction, "Link an account with `/create` or pass the user option.");
      const { data } = await api("/buy", "POST", { username: user, item });
      if (!data.ok) return fail(interaction, data.reason || "Purchase failed.");
      return respond(interaction, {
        embeds: [embed("Purchase complete", `**${user}** bought **${item}** from today's shop.`, 0x37d67a)],
      });
    }

    if (cmd === "change-username") {
      const newUsername = interaction.options.getString("new_username", true);
      const oldUsername =
        interaction.options.getString("old_username") || (await linkedUsername(interaction.user.id));
      if (!oldUsername) return fail(interaction, "Pass old_username or create/link an account first.");
      const { data } = await api("/change-username", "POST", {
        oldUsername,
        newUsername,
        discordUserId: interaction.user.id,
      });
      if (!data.ok) return fail(interaction, data.reason || "Rename failed.");
      return respond(interaction, {
        embeds: [
          embed("Username changed", `**${oldUsername}** → **${newUsername}**\nUse the new name in Velocity.`, 0x37d67a),
        ],
      });
    }

    if (cmd === "check-user") {
      const user = interaction.options.getString("user", true);
      const { data } = await api(`/check-user?username=${encodeURIComponent(user)}`);
      if (!data.ok) return fail(interaction, data.reason || "User not found.");
      return respond(interaction, {
        embeds: [
          embed(
            `User: ${data.username || user}`,
            [
              `**Account ID:** \`${data.accountId}\``,
              `**Online:** ${data.online ? "Yes" : "No"}`,
              `**Banned:** ${data.banned ? "Yes" : "No"}`,
              data.ban?.reason ? `**Ban reason:** ${data.ban.reason}` : "",
              `**V-Bucks:** ${data.vbucks?.toLocaleString?.() ?? data.vbucks}`,
              `**Items:** ${data.itemCount}`,
              `**Level:** ${data.level}`,
              `**Battle pass:** ${data.bookLevel}`,
              `**Arena hype:** ${data.arenaHype ?? 0}`,
              data.presence?.state ? `**State:** ${data.presence.state}` : "",
            ]
              .filter(Boolean)
              .join("\n")
          ),
        ],
      });
    }

    if (cmd === "claimvbucks") {
      const user = await resolveUser(interaction, "user");
      if (!user) return fail(interaction, "Link an account with `/create` or pass the user option.");
      const { data } = await api("/claim-vbucks", "POST", { username: user });
      if (!data.ok) return fail(interaction, data.reason || "Claim failed.");
      return respond(interaction, {
        embeds: [
          embed(
            "Daily V-Bucks claimed",
            `**${user}** received **250** V-Bucks.\nBalance: **${data.vbucks?.toLocaleString()}**`,
            0x37d67a
          ),
        ],
        ephemeral: true,
      });
    }

    if (cmd === "leaderboard") {
      const { data } = await api("/leaderboard");
      const lines = (data.entries || []).map(
        (e) => `**#${e.rank}** ${e.username || e.accountId.slice(0, 8)} — **${e.arenaHype}** hype`
      );
      return respond(interaction, {
        embeds: [
          embed(
            "Arena Leaderboard",
            lines.length ? lines.join("\n") : "_No arena scores yet — play Arena to appear here._"
          ),
        ],
      });
    }

    if (cmd === "custom-match-code-list") {
      const { data } = await api("/match-codes");
      const lines = (data.codes || []).map(
        (c) => `• **${c.code}** — ${c.playlist} (${c.region}) _by ${c.createdBy}_`
      );
      return respond(interaction, {
        embeds: [embed("Custom match codes", lines.length ? lines.join("\n") : "_No custom codes yet._")],
      });
    }

    // ---- Owner commands ----
    if (cmd === "add") {
      const pack = interaction.options.getString("pack", true);
      const user = interaction.options.getString("user", true);
      const amount = interaction.options.getInteger("amount");
      const item = interaction.options.getString("item");
      const { data } = await api("/add", "POST", { pack, username: user, amount, item });
      if (!data.ok) return fail(interaction, data.reason || "Add failed.", false);

      let msg = `Granted **${pack}** to **${user}**.`;
      if (data.granted != null) msg = `Granted **${data.granted}** items to **${user}**.`;
      if (data.vbucks != null) msg = `**${user}** now has **${data.vbucks.toLocaleString()}** V-Bucks.`;

      await logAction(client, `🎁 **${interaction.user.tag}** used /add ${pack} on **${user}**`);
      return respond(interaction, { embeds: [embed("Add complete", msg, 0x37d67a)] });
    }

    if (cmd === "ban") {
      const user = interaction.options.getString("user", true);
      const reason = interaction.options.getString("reason") || "Banned via Discord";
      const { data } = await api("/ban", "POST", {
        username: user,
        reason,
        bannedBy: `discord:${interaction.user.tag}`,
      });
      if (!data.ok) return fail(interaction, data.reason || "Ban failed.", false);
      await logAction(client, `🔨 **${interaction.user.tag}** banned **${user}** — ${reason}`);
      return respond(interaction, {
        embeds: [embed("Player banned", `**${user}** has been banned.\n**Reason:** ${reason}`, 0xff5c7c)],
      });
    }

    if (cmd === "unban") {
      const user = interaction.options.getString("user", true);
      const { data } = await api("/unban", "POST", { username: user });
      if (!data.ok) return fail(interaction, data.reason || "Unban failed.", false);
      await logAction(client, `✅ **${interaction.user.tag}** unbanned **${user}**`);
      return respond(interaction, { embeds: [embed("Player unbanned", `**${user}** can play again.`, 0x37d67a)] });
    }

    if (cmd === "remove") {
      const user = interaction.options.getString("user", true);
      const item = interaction.options.getString("item", true);
      const { data } = await api("/remove", "POST", { username: user, item });
      if (!data.ok) return fail(interaction, data.reason || "Remove failed.", false);
      return respond(interaction, {
        embeds: [embed("Item removed", `Removed \`${item}\` from **${user}** (${data.removed} item(s)).`, 0xfaa61a)],
      });
    }

    if (cmd === "delete") {
      const user = interaction.options.getString("user", true);
      const { data } = await api("/delete", "POST", { username: user });
      if (!data.ok) return fail(interaction, data.reason || "Delete failed.", false);
      await logAction(client, `🗑️ **${interaction.user.tag}** deleted account **${user}**`);
      return respond(interaction, {
        embeds: [embed("Account deleted", `**${user}**'s account was deleted.`, 0xff5c7c)],
      });
    }

    if (cmd === "create-test-acc") {
      const username = interaction.options.getString("username");
      const { data } = await api("/create-test-acc", "POST", { username });
      if (!data.ok) return fail(interaction, data.reason || "Failed.", false);
      return respond(interaction, {
        embeds: [
          embed(
            "Test account created",
            `**${data.username}**\nAccount ID: \`${data.accountId}\`\nAll cosmetics + max V-Bucks granted.`,
            0x37d67a
          ),
        ],
      });
    }

    if (cmd === "createhostaccount") {
      const username = interaction.options.getString("username");
      const { data } = await api("/create-host-account", "POST", { username });
      if (!data.ok) return fail(interaction, data.reason || "Failed.", false);
      return respond(interaction, {
        embeds: [
          embed(
            "Host account created",
            `**${data.username}**\nAccount ID: \`${data.accountId}\`\nUse this account to host matches.`,
            0x37d67a
          ),
        ],
      });
    }

    if (cmd === "createsac") {
      const code = interaction.options.getString("code", true);
      const displayName = interaction.options.getString("display_name");
      const { data } = await api("/sac", "POST", {
        code,
        displayName,
        createdBy: interaction.user.tag,
      });
      if (!data.ok) return fail(interaction, data.reason || "Failed.", false);
      return respond(interaction, {
        embeds: [embed("SAC created", `Support A Creator code **${data.entry.code}** is active.`, 0x37d67a)],
      });
    }

    if (cmd === "deletesac") {
      const code = interaction.options.getString("code", true);
      const { data } = await api("/sac/remove", "POST", { code });
      if (!data.ok) return fail(interaction, data.reason || "Failed.", false);
      return respond(interaction, { embeds: [embed("SAC deleted", `Removed SAC **${code}**.`, 0xfaa61a)] });
    }

    if (cmd === "create-custom-match-code") {
      const code = interaction.options.getString("code", true);
      const playlist = interaction.options.getString("playlist");
      const { data } = await api("/match-codes", "POST", {
        code,
        playlist,
        createdBy: interaction.user.tag,
      });
      if (!data.ok) return fail(interaction, data.reason || "Failed.", false);
      return respond(interaction, {
        embeds: [
          embed(
            "Match code created",
            `Code: **${data.entry.code}**\nPlaylist: ${data.entry.playlist}`,
            0x37d67a
          ),
        ],
      });
    }

    if (cmd === "status") {
      const { data } = await api("/status");
      return respond(interaction, {
        embeds: [
          embed(
            "Velocity Status",
            [
              `**Online:** ${data.online ? "Yes" : "No"}`,
              `**Players online:** ${data.connectedXmpp}`,
              `**Known accounts:** ${data.knownAccounts}`,
              `**Uptime:** ${Math.floor((data.uptimeSeconds || 0) / 60)} min`,
              data.owner?.username ? `**Owner:** ${data.owner.username}` : "",
            ]
              .filter(Boolean)
              .join("\n"),
            0x37d67a
          ),
        ],
      });
    }

    if (cmd === "players") {
      const { data } = await api("/players");
      const online = (data.online || []).map((p) => `• **${p.displayName}**`).join("\n") || "_Nobody online_";
      return respond(interaction, {
        embeds: [embed("Players", `**Online (${data.online?.length || 0})**\n${online}`)],
      });
    }

    if (cmd === "kick") {
      const user = interaction.options.getString("user", true);
      const reason = interaction.options.getString("reason") || "Kicked via Discord";
      const { data } = await api("/kick", "POST", { username: user, reason });
      if (!data.ok) return fail(interaction, data.reason || "Kick failed.", false);
      return respond(interaction, {
        embeds: [embed("Player kicked", `**${user}** disconnected.`, 0xfaa61a)],
      });
    }

    if (cmd === "bans") {
      const { data } = await api("/bans");
      const lines = (data.bans || []).map((b) => `• **${b.username || b.accountId.slice(0, 8)}** — ${b.reason}`);
      return respond(interaction, {
        embeds: [embed("Banned players", lines.length ? lines.join("\n") : "_No bans_", lines.length ? 0xff5c7c : 0x5865f2)],
      });
    }

    if (cmd === "motd") {
      const text = interaction.options.getString("text", true);
      const { data } = await api("/motd", "POST", { enabled: true, text });
      if (!data.ok) return fail(interaction, "MOTD update failed.", false);
      return respond(interaction, { embeds: [embed("MOTD updated", text.slice(0, 4000))] });
    }

    return fail(interaction, "Unknown command.");
  } catch (err) {
    console.error(err);
    return fail(interaction, `Error: ${err.message}`);
  }
});

if (!config.token) {
  console.error("Set your Discord bot token in config.json");
  process.exit(1);
}

client.login(config.token);
