// Unified auto-login launch args for every Fortnite season (no Epic login screen).
const http = require("http");
const { createHash } = require("crypto");
const {
  resolveBuildNumber,
  usesExchangeCodeAuth,
  getDirectLaunchExtras,
  needsCobaltRedirect,
  usesLibCurlHttp,
} = require("./launch-profiles");
const { getLibCurlLaunchArgs } = require("./libcurl-ssl");

function accountIdFromName(name) {
  return createHash("md5").update(String(name).toLowerCase()).digest("hex");
}

function normalizeBackendBase(base) {
  if (!base) return "http://127.0.0.1:3551";
  const trimmed = String(base).trim().replace(/\/$/, "");
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return `http://${trimmed}`;
}

function fetchExchangeCode(backendBase, username, retries = 3) {
  const base = normalizeBackendBase(backendBase);

  return new Promise((resolve, reject) => {
    const attempt = (left) => {
      const url = `${base}/account/api/oauth/exchange?username=${encodeURIComponent(username)}`;
      const req = http.get(url, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            if (json.code) return resolve(json.code);
          } catch {
            /* retry */
          }
          if (left > 1) return setTimeout(() => attempt(left - 1), 350);
          reject(new Error("No exchange code returned from Velocity backend"));
        });
      });
      req.on("error", (err) => {
        if (left > 1) return setTimeout(() => attempt(left - 1), 350);
        reject(err);
      });
      req.setTimeout(8000, () => {
        req.destroy();
        if (left > 1) attempt(left - 1);
        else reject(new Error("Exchange code request timed out"));
      });
    };
    attempt(retries);
  });
}

async function buildAuthArgs({ username, build, backendBase }) {
  // Chapter 1 early seasons: password grant via local backend.
  if (!usesExchangeCodeAuth(build)) {
    return [`-AUTH_LOGIN=${username}`, "-AUTH_PASSWORD=ogfn", "-AUTH_TYPE=epic"];
  }

  // 8.51+ must use a fresh exchange code — password fallback shows the Epic login UI.
  const code = await fetchExchangeCode(backendBase, username);
  return ["-AUTH_LOGIN=unused", "-AUTH_TYPE=exchangecode", `-AUTH_PASSWORD=${code}`];
}

async function buildGameLaunchArgs({
  cfg,
  shippingExe,
  backendBase,
  mods,
  extraArgs,
} = {}) {
  const username = cfg?.username || "VelocityPlayer";
  const accountId = accountIdFromName(username);
  const exe = shippingExe || cfg?.gamePath;
  const build = resolveBuildNumber(cfg, exe);
  const base = backendBase || cfg?.backendHost || "http://127.0.0.1:3551";
  const authArgs = await buildAuthArgs({ username, build, backendBase: base });

  const args = [
    ...authArgs,
    "-epicapp=Fortnite",
    "-epicenv=Prod",
    "-epiclocale=en-US",
    `-epicusername=${username}`,
    `-epicuserid=${accountId}`,
    "-skippatchcheck",
    ...getDirectLaunchExtras(build),
    build >= 27 ? "-EpicPortal" : "-epicportal",
  ];

  if (build >= 27) args.push("-epicsandboxid=fn");
  if (!needsCobaltRedirect(build)) args.push("-HTTP=WinInet");
  if (usesLibCurlHttp(build)) args.push(...getLibCurlLaunchArgs());

  const modFlags = mods || cfg?.mods || {};
  if (modFlags.editOnRelease) args.push("-EditOnRelease");
  if (modFlags.instantReset) args.push("-InstantReset");
  if (modFlags.sprintDefault) args.push("-SprintByDefault");
  if (modFlags.disablePreEdit) args.push("-DisablePreEdit");

  const userExtra = extraArgs ?? cfg?.extraArgs;
  if (userExtra) {
    const blocked = /^(-HTTP=|-noeac|-AUTH_|epic)/i;
    args.push(
      ...String(userExtra)
        .split(" ")
        .filter(Boolean)
        .filter((a) => !blocked.test(a))
    );
  }

  return { args, build, username, accountId };
}

module.exports = {
  accountIdFromName,
  normalizeBackendBase,
  fetchExchangeCode,
  buildAuthArgs,
  buildGameLaunchArgs,
};
