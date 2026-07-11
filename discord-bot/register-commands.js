const { REST, Routes } = require("discord.js");
const { commands } = require("./commands");

const config = require("./config.json");

async function main() {
  if (!config.token || !config.clientId) {
    console.error("Set token and clientId in config.json first.");
    process.exit(1);
  }

  const body = commands.map((c) => c.toJSON());
  const rest = new REST({ version: "10" }).setToken(config.token);

  if (config.guildId) {
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body });
    console.log(`Registered ${body.length} guild commands.`);
  } else {
    await rest.put(Routes.applicationCommands(config.clientId), { body });
    console.log(`Registered ${body.length} global commands.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
