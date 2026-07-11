const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

let botProcess = null;

function getDiscordBotDir(appPath) {
  if (appPath?.resourcesPath) {
    const packaged = path.join(appPath.resourcesPath, "discord-bot");
    if (fs.existsSync(path.join(packaged, "index.js"))) return packaged;
  }
  return path.join(__dirname, "..", "discord-bot");
}

function readBotConfig(botDir) {
  const cfgPath = path.join(botDir, "config.json");
  if (!fs.existsSync(cfgPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  } catch {
    return null;
  }
}

function canStartBot(appPath) {
  const botDir = getDiscordBotDir(appPath);
  const cfg = readBotConfig(botDir);
  if (!cfg?.token || cfg.token === "YOUR_DISCORD_BOT_TOKEN") return false;
  if (!fs.existsSync(path.join(botDir, "index.js"))) return false;
  if (!fs.existsSync(path.join(botDir, "node_modules", "discord.js"))) return false;
  return true;
}

function startDiscordBot(appPath) {
  if (botProcess) return true;
  if (!canStartBot(appPath)) return false;

  const botDir = getDiscordBotDir(appPath);
  const indexPath = path.join(botDir, "index.js");

  botProcess = spawn(process.execPath, [indexPath], {
    cwd: botDir,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  botProcess.stdout?.on("data", (d) => process.stdout.write(`[DISCORD-BOT] ${d}`));
  botProcess.stderr?.on("data", (d) => process.stdout.write(`[DISCORD-BOT] ${d}`));
  botProcess.on("exit", (code) => {
    botProcess = null;
    if (code && code !== 0) console.warn(`Discord bot exited with code ${code}`);
  });

  console.log("[DISCORD-BOT] Started from", botDir);
  return true;
}

function stopDiscordBot() {
  if (!botProcess) return;
  botProcess.kill();
  botProcess = null;
}

function isBotRunning() {
  return Boolean(botProcess);
}

module.exports = {
  getDiscordBotDir,
  canStartBot,
  startDiscordBot,
  stopDiscordBot,
  isBotRunning,
};
