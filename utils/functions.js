const crypto = require("crypto");

// Deterministic-ish account id from a display name so the same login is stable.
function accountIdFromName(name) {
  return crypto.createHash("md5").update(String(name).toLowerCase()).digest("hex");
}

// Generate an opaque bearer-ish token (not a real JWT, but the game only needs a string).
function makeToken(prefix = "eg1") {
  return `${prefix}~${crypto.randomBytes(24).toString("hex")}`;
}

function nowIso() {
  return new Date().toISOString();
}

// Fortnite version parsing from the User-Agent, e.g.
// "Fortnite/++Fortnite+Release-7.40-CL-4834550-Windows"
function getVersionInfo(req) {
  const ua = req.headers["user-agent"] || "";
  let build = 1.0;
  let cl = "0";
  let season = 0;

  const buildMatch = ua.match(/Release-(\d+\.\d+)/);
  if (buildMatch) {
    build = parseFloat(buildMatch[1]);
    season = Math.floor(build);
  }
  const clMatch = ua.match(/-CL-(\d+)/);
  if (clMatch) cl = clMatch[1];

  return { season, build, cl, netcl: cl };
}

module.exports = { accountIdFromName, makeToken, nowIso, getVersionInfo };
