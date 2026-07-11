// Version-specific anti-cheat / launcher bypass args for FortniteClient-Win64-Shipping.

function parseBuildNumber(input) {
  if (!input) return 0;
  const m = String(input).match(/(\d+)\.(\d+)/);
  if (!m) return 0;
  return parseFloat(`${m[1]}.${m[2]}`);
}

function parseBuildFromPath(exePath) {
  if (!exePath) return 0;
  const s = String(exePath).replace(/\\/g, "/");
  const release = s.match(/Release-(\d+)\.(\d+)/i);
  if (release) return parseFloat(`${release[1]}.${release[2]}`);
  const folder = s.match(/\/(\d+)\.(\d+)\/FortniteGame\//i);
  if (folder) return parseFloat(`${folder[1]}.${folder[2]}`);
  return 0;
}

function resolveBuildNumber(cfg, shippingExe) {
  const fromPath = parseBuildFromPath(shippingExe);
  if (fromPath > 0) return fromPath;

  const selected = (cfg?.versions || []).find((v) => v.exePath === shippingExe);
  if (selected?.name) return parseBuildNumber(selected.name);
  if (selected?.build) return parseBuildNumber(selected.build);
  return parseBuildNumber(shippingExe);
}

// Chapter 4+ (23+) used FortniteLauncher; v27+ needs direct shipping (ES256 Caldera).
function needsLauncherProcess(build) {
  return build >= 23 && build < 27;
}

function shouldLaunchShippingDirect(build) {
  return build >= 27;
}

function shouldBlockAntiCheatFiles(build) {
  return build < 23;
}

function shouldUseLauncherStub(build) {
  return build < 23;
}

function shouldSuppressEpicLauncher(build) {
  return build < 23;
}

function needsCobaltRedirect(build) {
  return build >= 23;
}

function needsCalderaEra(build) {
  return build >= 19 && build < 23;
}

function getAntiCheatArgs(build) {
  // v27+ (Ch5): fltoken bypasses Epic launcher check; Caldera/FL chain needs real Epic ES256.
  if (build >= 27) {
    return ["-nobe", "-fromfl=eac", "-fltoken=h1cdhchd10150221h130eB56"];
  }
  // Ch4 (23–26): FortniteLauncher + Cobalt redirect.
  if (build >= 23) {
    return ["-nobe", "-noeaceos", "-fromfl=be"];
  }
  if (build >= 19) {
    return ["-nobe", "-fromfl=be"];
  }
  if (build >= 8.51) {
    return ["-nobe", "-fromfl=eac", "-fltoken=h1cdhchd10150221h130eB56"];
  }
  if (build >= 7.3) {
    return ["-noeac", "-fromfl=be", "-fltoken=db04e37196g0h6h8e003c19d"];
  }
  return ["-noeac"];
}

// Caldera JWTs are build-specific (Ch3). Launcher path handles 23+ automatically.
const CALDERA_BY_BUILD = {
  19: "-caldera=eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJhY2NvdW50X2lkIjoiZmY0YzEyMjQ5NzU5NGI5MGJlMDk1OWYxOGM2NWQwOGIiLCJnZW5lcmF0ZWQiOjE2NDEwOTI1NjUsImNhbGRlcmFHdWlkIjoiODQ0ODdkZmMtMGMxNC00YTUyLWFmYjgtNGY1ZWM5YzQyMjg0IiwiYWNQcm92aWRlciI6IkJhdHRsRXllIiwibm90ZXMiOiIiLCJmYWxsYmFjayI6ZmFsc2V9.E74n07NqNGmPPJ7NnK9EewIIb2Yjj3YP6Ghqrsd2iBe8e-z-ZkUiUwIH0DTd78yB5UDBDXdzOKBdsD0Mdjy5_A",
  20: "-caldera=eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJhY2NvdW50X2lkIjoiOWM1MDY1MTEwYzdhNGQ3MDk1ODYyZGE1ZWU4MTU5NjIiLCJnZW5lcmF0ZWQiOjE2NDc3ODMxMDcsImNhbGRlcmFHdWlkIjoiYmEwMmEyZWItZWU2NS00NjkxLWIwYWItNjUwMzE0ODRhMTQ3IiwiYWNQcm92aWRlciI6IkVhc3lBbnRpQ2hlYXQiLCJub3RlcyI6IiIsImZhbGxiYWNrIjpmYWxzZX0.U9a2eGUx9bSvc3fg-SQjr87O_vdxBC7GSfoUoIOxBDxeGFGQnSUABVt7lGA_Bq9d-s5mHQRWi6CfjWtUxxMTvA",
  21: "-caldera=eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJhY2NvdW50X2lkIjoiOWM1MDY1MTEwYzdhNGQ3MDk1ODYyZGE1ZWU4MTU5NjIiLCJnZW5lcmF0ZWQiOjE2NTQ0MzU1MjYsImNhbGRlcmFHdWlkIjoiN2NjMjg0ZmYtMmM3Mi00OGY4LWI4ZTctYTc1MjI2MTdhODczIiwiYWNQcm92aWRlciI6IkJhdHRsRXllIiwibm90ZXMiOiIiLCJmYWxsYmFjayI6ZmFsc2V9.UmtiS1v4hnrxTy-EWv0g0VZna0MSwDspmxg1VOb2PnugFglMY7bU8U9Oh6jt-B9W8IxfFiSlk1jCqLjNuBI6fw",
  22: "-caldera=eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJhY2NvdW50X2lkIjoiOWM1MDY1MTEwYzdhNGQ3MDk1ODYyZGE1ZWU4MTU5NjIiLCJnZW5lcmF0ZWQiOjE2NjczMjMxMzYsImNhbGRlcmFHdWlkIjoiOGFkOTEyZGYtZTcwMy00NmJhLWE2ZjQtOWM3ZGE4NjMzN2FmIiwiYWNQcm92aWRlciI6IkJhdHRsRXllIiwibm90ZXMiOiIiLCJmYWxsYmFjayI6ZmFsc2V9.m6wk19aqhW3yGrPcR3OqNwZJbwF3Bv5Dv9p-elzJwG670Xn0yb2Y2CCvkKzR9XNDX6mzgCTlo2SIpiK1Du2xNA",
};

function getCalderaArg(build) {
  const major = Math.floor(build);
  return CALDERA_BY_BUILD[major] || CALDERA_BY_BUILD[22];
}

function getDirectLaunchExtras(build) {
  const extras = [...getAntiCheatArgs(build)];
  if (needsCalderaEra(build)) extras.push(getCalderaArg(build));
  return extras;
}

/** Password auth works on early Chapter 1; exchange codes from ~S8 / 8.51+. */
function usesExchangeCodeAuth(build) {
  return build >= 8.51;
}

/** Chapter 2/3 use libcurl+OpenSSL for HTTPS — needs SSL bypass or custom CA bundle. */
function usesLibCurlHttp(build) {
  return build >= 8.51 && build < 23;
}

module.exports = {
  parseBuildNumber,
  parseBuildFromPath,
  resolveBuildNumber,
  needsLauncherProcess,
  shouldLaunchShippingDirect,
  shouldBlockAntiCheatFiles,
  shouldUseLauncherStub,
  shouldSuppressEpicLauncher,
  needsCobaltRedirect,
  usesLibCurlHttp,
  getDirectLaunchExtras,
  usesExchangeCodeAuth,
};
