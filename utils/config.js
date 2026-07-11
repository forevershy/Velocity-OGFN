const fs = require("fs");
const path = require("path");

const configDir = path.join(__dirname, "..", "config");
const configPath = path.join(configDir, "config.json");
const examplePath = path.join(configDir, "config.example.json");

function ensureConfigFile() {
  if (fs.existsSync(configPath)) return configPath;
  if (!fs.existsSync(examplePath)) {
    throw new Error("Missing config/config.json and config/config.example.json");
  }
  fs.mkdirSync(configDir, { recursive: true });
  fs.copyFileSync(examplePath, configPath);
  return configPath;
}

function loadConfig() {
  ensureConfigFile();
  delete require.cache[require.resolve(configPath)];
  return require(configPath);
}

module.exports = { configPath, ensureConfigFile, loadConfig };
