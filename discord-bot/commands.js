const { SlashCommandBuilder } = require("discord.js");

const PACK_CHOICES = [
  { name: "All cosmetics", value: "all" },
  { name: "V-Bucks", value: "vbucks" },
  { name: "Battle pass (tier 100)", value: "battlepass" },
  { name: "Level 100", value: "level" },
  { name: "Single item", value: "item" },
];

const commands = [
  // ---- Player commands ----
  new SlashCommandBuilder()
    .setName("create")
    .setDescription("Create an account on Velocity Backend")
    .addStringOption((o) => o.setName("username").setDescription("Your OGFN username").setRequired(true)),
  new SlashCommandBuilder()
    .setName("appeal")
    .setDescription("Appeal your ban from the backend")
    .addStringOption((o) => o.setName("reason").setDescription("Why you should be unbanned").setRequired(false)),
  new SlashCommandBuilder()
    .setName("buy")
    .setDescription("Buy a cosmetic from the current item shop")
    .addStringOption((o) => o.setName("item").setDescription("Item name from today's shop").setRequired(true))
    .addStringOption((o) => o.setName("user").setDescription("OGFN username (defaults to your linked account)").setRequired(false)),
  new SlashCommandBuilder()
    .setName("change-username")
    .setDescription("Change your username")
    .addStringOption((o) => o.setName("new_username").setDescription("New username").setRequired(true))
    .addStringOption((o) => o.setName("old_username").setDescription("Current username if not linked").setRequired(false)),
  new SlashCommandBuilder()
    .setName("check-user")
    .setDescription("Fetch information about a user account")
    .addStringOption((o) => o.setName("user").setDescription("OGFN username").setRequired(true)),
  new SlashCommandBuilder()
    .setName("claimvbucks")
    .setDescription("Claim your daily 250 V-Bucks")
    .addStringOption((o) => o.setName("user").setDescription("OGFN username (defaults to linked account)").setRequired(false)),
  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Top 10 players with the most Arena Hype points"),

  // ---- Owner / staff commands ----
  new SlashCommandBuilder()
    .setName("add")
    .setDescription("Give a user cosmetic packs or V-Bucks")
    .addStringOption((o) =>
      o.setName("pack").setDescription("What to grant").setRequired(true).addChoices(...PACK_CHOICES)
    )
    .addStringOption((o) => o.setName("user").setDescription("OGFN username").setRequired(true))
    .addIntegerOption((o) => o.setName("amount").setDescription("Amount for vbucks/level/bp").setRequired(false))
    .addStringOption((o) =>
      o.setName("item").setDescription("Template ID when pack is item").setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a user from the backend by their username")
    .addStringOption((o) => o.setName("user").setDescription("OGFN username").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Ban reason").setRequired(false)),
  new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Unban a user from the backend by their username")
    .addStringOption((o) => o.setName("user").setDescription("OGFN username").setRequired(true)),
  new SlashCommandBuilder()
    .setName("remove")
    .setDescription("Remove an item from a user's locker")
    .addStringOption((o) => o.setName("user").setDescription("OGFN username").setRequired(true))
    .addStringOption((o) => o.setName("item").setDescription("Template ID to remove").setRequired(true)),
  new SlashCommandBuilder()
    .setName("delete")
    .setDescription("Delete a user's account")
    .addStringOption((o) => o.setName("user").setDescription("OGFN username").setRequired(true)),
  new SlashCommandBuilder()
    .setName("create-test-acc")
    .setDescription("Create a test account with all cosmetics")
    .addStringOption((o) => o.setName("username").setDescription("Optional username").setRequired(false)),
  new SlashCommandBuilder()
    .setName("createhostaccount")
    .setDescription("Create a host account for Velocity Backend")
    .addStringOption((o) => o.setName("username").setDescription("Optional username").setRequired(false)),
  new SlashCommandBuilder()
    .setName("createsac")
    .setDescription("Create a Support A Creator code")
    .addStringOption((o) => o.setName("code").setDescription("SAC code slug").setRequired(true))
    .addStringOption((o) => o.setName("display_name").setDescription("Display name").setRequired(false)),
  new SlashCommandBuilder()
    .setName("deletesac")
    .setDescription("Delete a Support A Creator code")
    .addStringOption((o) => o.setName("code").setDescription("SAC code to delete").setRequired(true)),
  new SlashCommandBuilder()
    .setName("create-custom-match-code")
    .setDescription("Create a custom matchmaking code")
    .addStringOption((o) => o.setName("code").setDescription("Match code (4–16 chars)").setRequired(true))
    .addStringOption((o) =>
      o.setName("playlist").setDescription("Playlist, e.g. Playlist_DefaultSolo").setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("custom-match-code-list")
    .setDescription("List all custom matchmaking codes"),

  // ---- Extra admin helpers (kept from prior bot) ----
  new SlashCommandBuilder().setName("status").setDescription("Show Velocity backend status"),
  new SlashCommandBuilder().setName("players").setDescription("List online and known players"),
  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kick a player from the game")
    .addStringOption((o) => o.setName("user").setDescription("OGFN username").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Kick reason").setRequired(false)),
  new SlashCommandBuilder().setName("bans").setDescription("List banned players"),
  new SlashCommandBuilder()
    .setName("motd")
    .setDescription("Set the in-game message of the day")
    .addStringOption((o) => o.setName("text").setDescription("MOTD text").setRequired(true)),
];

const OWNER_COMMANDS = new Set([
  "add",
  "ban",
  "unban",
  "remove",
  "delete",
  "create-test-acc",
  "createhostaccount",
  "createsac",
  "deletesac",
  "create-custom-match-code",
  "status",
  "players",
  "kick",
  "bans",
  "motd",
]);

module.exports = { commands, OWNER_COMMANDS };
