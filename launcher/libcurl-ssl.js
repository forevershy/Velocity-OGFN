// Chapter 2/3 builds use libcurl+OpenSSL (not WinInet). They reject Velocity's HTTPS
// cert unless peer verification is disabled or our CA is in the bundle libcurl loads.
const fs = require("fs");
const path = require("path");
const https = require("https");

const NETWORK_SECTION = "[/Script/Engine.NetworkSettings]";
const VERIFY_PEER_OFF = "n.VerifyPeer=False";
const MOZILLA_CA_URL = "https://curl.se/ca/cacert.pem";

const ENGINE_BLOCK = `${NETWORK_SECTION}
${VERIFY_PEER_OFF}

[ConsoleVariables]
${VERIFY_PEER_OFF}
`;

function savedEngineIniPath() {
  const local = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Local");
  return path.join(local, "FortniteGame", "Saved", "Config", "WindowsClient", "Engine.ini");
}

function pcoptbakPath() {
  return `${savedEngineIniPath()}.pcoptbak`;
}

function gameRootFromShippingExe(shippingExe) {
  return path.dirname(path.dirname(path.dirname(path.dirname(shippingExe))));
}

function unlockSavedEngineIni() {
  const engineIni = savedEngineIniPath();
  try {
    if (fs.existsSync(engineIni)) fs.chmodSync(engineIni, 0o666);
  } catch {
    /* best effort */
  }
}

function lockSavedEngineIni() {
  const engineIni = savedEngineIniPath();
  try {
    if (fs.existsSync(engineIni)) fs.chmodSync(engineIni, 0o444);
  } catch {
    /* best effort */
  }
}

function loadEngineIniBase() {
  const engineIni = savedEngineIniPath();
  const backup = pcoptbakPath();

  for (const candidate of [backup, engineIni]) {
    try {
      if (fs.existsSync(candidate)) {
        const text = fs.readFileSync(candidate, "utf8");
        if (text.trim()) return text;
      }
    } catch {
      /* try next */
    }
  }
  return "";
}

function upsertNetworkSettings(iniText) {
  let text = iniText || "";

  // Strip any prior VerifyPeer lines anywhere in the file (game may have merged defaults).
  text = text.replace(/^\s*n\.VerifyPeer\s*=\s*\S+\s*$/gim, "");

  const sectionRe = /\[\/Script\/Engine\.NetworkSettings\][^\[]*/i;
  if (sectionRe.test(text)) {
    text = text.replace(sectionRe, (block) => {
      const trimmed = block.trimEnd();
      return `${trimmed}\r\n${VERIFY_PEER_OFF}\r\n`;
    });
  } else {
    const prefix = text.trimEnd() ? `${text.trimEnd()}\r\n\r\n` : "";
    text = `${prefix}; Velocity — trust local Epic HTTPS redirect (libcurl/OpenSSL)\r\n${ENGINE_BLOCK}\r\n`;
  }

  const consoleRe = /\[ConsoleVariables\][^\[]*/i;
  if (consoleRe.test(text)) {
    text = text.replace(consoleRe, (block) => {
      const trimmed = block.trimEnd();
      if (/n\.VerifyPeer\s*=/i.test(block)) {
        return block.replace(/n\.VerifyPeer\s*=\s*\S+/gi, VERIFY_PEER_OFF);
      }
      return `${trimmed}\r\n${VERIFY_PEER_OFF}\r\n`;
    });
  } else {
    text = `${text.trimEnd()}\r\n\r\n[ConsoleVariables]\r\n${VERIFY_PEER_OFF}\r\n`;
  }

  return text;
}

function patchSavedEngineIni() {
  const engineIni = savedEngineIniPath();
  fs.mkdirSync(path.dirname(engineIni), { recursive: true });

  unlockSavedEngineIni();
  const next = upsertNetworkSettings(loadEngineIniBase());
  fs.writeFileSync(engineIni, next, "utf8");
  lockSavedEngineIni();

  return { ok: true, engineIni, fromPcoptbak: fs.existsSync(pcoptbakPath()) };
}

function fetchMozillaCaBundle() {
  return new Promise((resolve, reject) => {
    https
      .get(MOZILLA_CA_URL, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Mozilla CA download failed: HTTP ${res.statusCode}`));
          return;
        }
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve(data));
      })
      .on("error", reject)
      .setTimeout(15000, function onTimeout() {
        this.destroy();
        reject(new Error("Mozilla CA download timed out"));
      });
  });
}

async function ensureCaBundle(shippingExe, certDir) {
  if (!shippingExe) return { ok: false, reason: "missing exe" };

  const root = gameRootFromShippingExe(shippingExe);
  const certBundleDir = path.join(root, "FortniteGame", "Content", "Certificates");
  const caDest = path.join(certBundleDir, "cacert.pem");
  const velocityCa = certDir ? path.join(certDir, "velocity-ca.crt") : null;

  if (!velocityCa || !fs.existsSync(velocityCa)) {
    return { ok: false, reason: "velocity CA missing" };
  }

  fs.mkdirSync(certBundleDir, { recursive: true });
  const caPem = fs.readFileSync(velocityCa, "utf8").trim();

  let bundle = "";
  if (fs.existsSync(caDest)) {
    bundle = fs.readFileSync(caDest, "utf8");
    if (bundle.includes("Velocity Local CA") && bundle.includes("-----BEGIN CERTIFICATE-----")) {
      return { ok: true, caDest, reused: true };
    }
  }

  try {
    bundle = await fetchMozillaCaBundle();
  } catch {
    bundle = "";
  }

  if (!bundle.includes("-----BEGIN CERTIFICATE-----")) {
    bundle = caPem;
  } else if (!bundle.includes("Velocity Local CA")) {
    bundle = `${bundle.trim()}\n${caPem}\n`;
  }

  fs.writeFileSync(caDest, bundle.endsWith("\n") ? bundle : `${bundle}\n`, "utf8");
  return { ok: true, caDest, reused: false };
}

function getLibCurlEnv(caDest) {
  if (!caDest || !fs.existsSync(caDest)) return {};
  const ca = path.resolve(caDest);
  return {
    CURL_CA_BUNDLE: ca,
    SSL_CERT_FILE: ca,
    SSL_CERT_DIR: path.dirname(ca),
  };
}

async function ensureLibCurlSslFix(shippingExe, certDir) {
  const saved = patchSavedEngineIni();
  let ca = { ok: false };
  try {
    ca = await ensureCaBundle(shippingExe, certDir);
  } catch {
    /* optional */
  }
  return {
    ok: true,
    savedEngineIni: saved.engineIni,
    fromPcoptbak: saved.fromPcoptbak,
    caDest: ca.caDest,
    env: getLibCurlEnv(ca.caDest),
  };
}

function getLibCurlLaunchArgs() {
  return [
    "-bVerifyPeer=0",
    "-ini:Engine:[/Script/Engine.NetworkSettings]:n.VerifyPeer=False",
    "-n.VerifyPeer=0",
  ];
}

module.exports = {
  savedEngineIniPath,
  pcoptbakPath,
  gameRootFromShippingExe,
  unlockSavedEngineIni,
  patchSavedEngineIni,
  ensureLibCurlSslFix,
  getLibCurlLaunchArgs,
  getLibCurlEnv,
};
