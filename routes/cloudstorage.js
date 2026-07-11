const express = require("express");
const app = express.Router();
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const log = require("../utils/logger");

const systemDir = path.join(__dirname, "..", "cloudstorage", "system");
const userDir = path.join(__dirname, "..", "cloudstorage", "user");
fs.mkdirSync(systemDir, { recursive: true });
fs.mkdirSync(userDir, { recursive: true });

function fileMeta(dir, file) {
  const full = path.join(dir, file);
  const data = fs.readFileSync(full);
  return {
    uniqueFilename: file,
    filename: file,
    hash: crypto.createHash("sha1").update(data).digest("hex"),
    hash256: crypto.createHash("sha256").update(data).digest("hex"),
    length: data.length,
    contentType: "application/octet-stream",
    uploaded: fs.statSync(full).mtime.toISOString(),
    storageType: "S3",
    storageIds: {},
    doNotCache: true,
  };
}

// ---- System (hotfix) files list ----
app.get("/fortnite/api/cloudstorage/system", (req, res) => {
  const files = fs
    .readdirSync(systemDir)
    .filter((f) => f.endsWith(".ini"))
    .map((f) => fileMeta(systemDir, f));
  res.json(files);
});

// ---- Individual system file ----
app.get("/fortnite/api/cloudstorage/system/:file", (req, res) => {
  const full = path.join(systemDir, path.basename(req.params.file));
  if (!fs.existsSync(full)) return res.status(200).end();
  res.set("Content-Type", "application/octet-stream");
  res.send(fs.readFileSync(full));
});

app.get("/fortnite/api/cloudstorage/system/config", (req, res) =>
  res.json({ enumerateFilesPath: "/api/cloudstorage/system", enableMigration: false })
);

// ---- User settings list ----
app.get("/fortnite/api/cloudstorage/user/:accountId", (req, res) => {
  const dir = path.join(userDir, req.params.accountId);
  if (!fs.existsSync(dir)) return res.json([]);
  const files = fs
    .readdirSync(dir)
    .map((f) => ({ ...fileMeta(dir, f), accountId: req.params.accountId }));
  res.json(files);
});

// ---- Read a user setting file (usually ClientSettings.Sav) ----
app.get("/fortnite/api/cloudstorage/user/:accountId/:file", (req, res) => {
  const full = path.join(userDir, req.params.accountId, path.basename(req.params.file));
  if (!fs.existsSync(full)) return res.status(200).end();
  res.set("Content-Type", "application/octet-stream");
  res.send(fs.readFileSync(full));
});

// ---- Write a user setting file ----
app.put("/fortnite/api/cloudstorage/user/:accountId/:file", (req, res) => {
  const dir = path.join(userDir, req.params.accountId);
  fs.mkdirSync(dir, { recursive: true });
  const full = path.join(dir, path.basename(req.params.file));
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
  fs.writeFileSync(full, body);
  log.backend(`Saved user cloudstorage: ${req.params.accountId}/${req.params.file}`);
  res.status(204).end();
});

module.exports = app;
