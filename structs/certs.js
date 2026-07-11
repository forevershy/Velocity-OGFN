// Local TLS certificate authority for the WinInet redirect method.
//
// OG Fortnite builds talk to Epic domains over HTTPS. When we redirect those
// domains to the local backend (via the Windows hosts file) the game still
// validates the TLS certificate, so we need a cert that (a) is signed by a CA
// Windows trusts and (b) covers the Epic hostnames. This module generates a
// self-signed CA plus a leaf certificate for *.ol.epicgames.com et al.
//
// Pure JS (node-forge) so it works inside the Electron-bundled node backend
// with no native dependencies.
const fs = require("fs");
const path = require("path");
const forge = require("node-forge");

const epicHosts = require("./epicHosts");

// Certificate SANs. Wildcards cover one subdomain level; Season 4+ uses
// *.ak.epicgames.com shards which need their own wildcard entry.
// Caldera lives under ecosec.on.epicgames.com (not *.epicgames.com).
const CALDERA_SANS = epicHosts.filter(
  (h) => h.includes("ecosec.on.epicgames.com") || h.includes("ecac.dev.use1a.on.epicgames.com")
);

const CERT_SANS = [
  "*.ak.epicgames.com",
  "ak.epicgames.com",
  "*.ol.epicgames.com",
  "ol.epicgames.com",
  "*.epicgames.com",
  "epicgames.com",
  "*.unrealengine.com",
  "unrealengine.com",
  "*.ecosec.on.epicgames.com",
  "ecosec.on.epicgames.com",
  "*.ecac.dev.use1a.on.epicgames.com",
  ...CALDERA_SANS,
  "localhost",
];

const CERT_VERSION = 3;

function fileset(certDir) {
  return {
    caCert: path.join(certDir, "velocity-ca.crt"),
    serverKey: path.join(certDir, "velocity-server.key"),
    serverCert: path.join(certDir, "velocity-server.crt"),
  };
}

function generate(certDir) {
  const pki = forge.pki;
  fs.mkdirSync(certDir, { recursive: true });

  const caAttrs = [
    { name: "commonName", value: "Velocity Local CA" },
    { name: "organizationName", value: "Velocity" },
  ];

  // --- Root CA ---
  const caKeys = pki.rsa.generateKeyPair(2048);
  const caCert = pki.createCertificate();
  caCert.publicKey = caKeys.publicKey;
  caCert.serialNumber = "01";
  caCert.validity.notBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
  caCert.validity.notAfter = new Date(Date.now() + 3650 * 24 * 60 * 60 * 1000);
  caCert.setSubject(caAttrs);
  caCert.setIssuer(caAttrs);
  caCert.setExtensions([
    { name: "basicConstraints", cA: true },
    { name: "keyUsage", keyCertSign: true, cRLSign: true, digitalSignature: true },
  ]);
  caCert.sign(caKeys.privateKey, forge.md.sha256.create());

  // --- Leaf (server) cert signed by the CA ---
  const leafKeys = pki.rsa.generateKeyPair(2048);
  const leaf = pki.createCertificate();
  leaf.publicKey = leafKeys.publicKey;
  leaf.serialNumber = "02";
  leaf.validity.notBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
  leaf.validity.notAfter = new Date(Date.now() + 3650 * 24 * 60 * 60 * 1000);
  leaf.setSubject([
    { name: "commonName", value: "*.ol.epicgames.com" },
    { name: "organizationName", value: "Velocity" },
  ]);
  leaf.setIssuer(caAttrs);
  const altNames = CERT_SANS.map((d) => ({ type: 2, value: d }));
  altNames.push({ type: 7, ip: "127.0.0.1" });
  leaf.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
    { name: "extKeyUsage", serverAuth: true },
    { name: "subjectAltName", altNames },
  ]);
  leaf.sign(caKeys.privateKey, forge.md.sha256.create());

  const files = fileset(certDir);
  fs.writeFileSync(files.caCert, pki.certificateToPem(caCert));
  fs.writeFileSync(files.serverKey, pki.privateKeyToPem(leafKeys.privateKey));
  // Server cert bundled with the CA so clients get the full chain.
  fs.writeFileSync(
    files.serverCert,
    pki.certificateToPem(leaf) + pki.certificateToPem(caCert)
  );
  return files;
}

function resolveCertDir(explicit) {
  if (explicit) return explicit;
  if (process.env.VELOCITY_CERT_DIR) return process.env.VELOCITY_CERT_DIR;
  const appData = process.env.APPDATA;
  if (appData) return path.join(appData, "velocity-app", "certs");
  return path.join(__dirname, "..", ".certs");
}

// Returns cert file paths, generating them the first time (or after SAN updates).
function ensureCerts(certDir) {
  certDir = resolveCertDir(certDir);
  const files = fileset(certDir);
  const versionFile = path.join(certDir, ".cert-version");
  const versionOk =
    fs.existsSync(versionFile) && fs.readFileSync(versionFile, "utf8").trim() === String(CERT_VERSION);
  const allExist = Object.values(files).every((f) => fs.existsSync(f));
  if (allExist && versionOk) return files;

  for (const f of Object.values(files)) {
    try {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    } catch {
      /* stale file */
    }
  }
  const generated = generate(certDir);
  fs.writeFileSync(versionFile, String(CERT_VERSION));
  return generated;
}

// HTTPS options (key + full-chain cert) for https.createServer.
function httpsOptions(certDir) {
  const files = ensureCerts(certDir);
  return {
    key: fs.readFileSync(files.serverKey),
    cert: fs.readFileSync(files.serverCert),
  };
}

module.exports = { ensureCerts, httpsOptions, fileset, resolveCertDir, CERT_SANS };
