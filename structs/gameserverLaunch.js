const { createHash } = require("crypto");
const { accountIdFromName } = require("../utils/functions");

function parseBuild(gamePath) {
  const m = String(gamePath || "").match(/(\d+)\.(\d+)/);
  if (!m) return 0;
  return parseFloat(`${m[1]}.${m[2]}`);
}

function getAntiCheatArgs(build) {
  if (build >= 27) return ["-nobe", "-fromfl=eac", "-fltoken=h1cdhchd10150221h130eB56"];
  if (build >= 23) return ["-nobe", "-noeaceos", "-fromfl=be"];
  if (build >= 19) return ["-nobe", "-fromfl=be"];
  if (build >= 8.51) return ["-nobe", "-fromfl=eac", "-fltoken=h1cdhchd10150221h130eB56"];
  if (build >= 7.3) return ["-noeac", "-fromfl=be", "-fltoken=db04e37196g0h6h8e003c19d"];
  return ["-noeac"];
}

function usesLibCurlHttp(build) {
  return build >= 8.51 && build < 23;
}

function getLibCurlLaunchArgs() {
  return [
    "-bVerifyPeer=0",
    "-ini:Engine:[/Script/Engine.NetworkSettings]:n.VerifyPeer=False",
    "-n.VerifyPeer=0",
  ];
}

function resolveGamePath(gs) {
  return (
    gs?.gamePath ||
    process.env.VELOCITY_GAME_PATH ||
    process.env.VELOCITY_GS_GAME_PATH ||
    ""
  );
}

function resolveUsername(config) {
  return process.env.VELOCITY_USERNAME || config?.owner?.username || "VelocityPlayer";
}

function resolveAccountId(config, username) {
  return config?.owner?.accountId || accountIdFromName(username);
}

function buildGameserverArgs({
  config,
  gs,
  build,
  username,
  accountId,
  playlist,
  port,
  useExchangeCode = false,
  exchangeCode = "",
}) {
  const pl = playlist || gs.playlist || "Playlist_DefaultSolo";
  const listenPort = Number(port || gs.port || 7777);

  const authArgs =
    useExchangeCode && exchangeCode
      ? ["-AUTH_LOGIN=unused", "-AUTH_TYPE=exchangecode", `-AUTH_PASSWORD=${exchangeCode}`]
      : [`-AUTH_LOGIN=${username}`, "-AUTH_PASSWORD=ogfn", "-AUTH_TYPE=epic"];

  const args = [
    "-server",
    "-log",
    "-nosteam",
    "-nosound",
    "-messaging",
    ...getAntiCheatArgs(build),
    "-skippatchcheck",
    ...(usesLibCurlHttp(build) ? getLibCurlLaunchArgs() : ["-HTTP=WinInet"]),
    ...authArgs,
    "-epicapp=Fortnite",
    "-epicenv=Prod",
    "-epiclocale=en-US",
    `-epicusername=${username}`,
    `-epicuserid=${accountId}`,
    "-epicportal",
    `-PORT=${listenPort}`,
    `-Playlist=${pl}`,
  ];

  return args;
}

module.exports = {
  parseBuild,
  getAntiCheatArgs,
  usesLibCurlHttp,
  getLibCurlLaunchArgs,
  resolveGamePath,
  resolveUsername,
  resolveAccountId,
  buildGameserverArgs,
};
