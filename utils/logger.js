// Tiny zero-dependency colored logger.
const colors = {
  reset: "\x1b[0m",
  gray: "\x1b[90m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  red: "\x1b[31m",
};

function stamp() {
  return new Date().toLocaleTimeString();
}

function line(color, tag, msg) {
  console.log(`${colors.gray}[${stamp()}]${colors.reset} ${color}[${tag}]${colors.reset} ${msg}`);
}

module.exports = {
  backend: (m) => line(colors.cyan, "BACKEND", m),
  request: (m) => line(colors.gray, "REQUEST", m),
  xmpp: (m) => line(colors.magenta, "XMPP", m),
  mcp: (m) => line(colors.green, "MCP", m),
  warn: (m) => line(colors.yellow, "WARN", m),
  matchmaker: (m) => line(colors.green, "MATCHMAKER", m),
  error: (m) => line(colors.red, "ERROR", m),
};
