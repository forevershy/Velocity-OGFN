const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");
const https = require("https");
const os = require("os");
const { pathToFileURL } = require("url");
const { spawn, exec } = require("child_process");

const discordPresence = require("./discord-presence");
const discordBotHost = require("./discord-bot-host");
const netSetup = require("./net-setup");
const { launchFortnite } = require("./launch-game");
const { installCustomPaks } = require("./custom-paks");
const { resolveBuildNumber } = require("./launch-profiles");
const { buildGameLaunchArgs } = require("./auth-launch");
const { ensureGameserver, stopGameserver } = require("./gameserver-host");
const { isProcessRunning, isFortniteGameRunning } = require("./process-utils");

const CONFIG_PATH = path.join(app.getPath("userData"), "velocity-launcher.json");
const CERT_DIR = path.join(app.getPath("userData"), "certs");

let win;
let backendProcess = null;
let currentView = "home";
let presenceTimer = null;
let gameWatchTimer = null;
let fortniteRunning = false;

function getBackendDir() {
  if (app.isPackaged) return path.join(process.resourcesPath, "backend");
  return path.join(__dirname, "..");
}

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    // Migrate old config filename if present.
    const legacy = path.join(app.getPath("userData"), "ogfn-launcher.json");
    if (fs.existsSync(legacy)) {
      try {
        const cfg = JSON.parse(fs.readFileSync(legacy, "utf8"));
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
        return cfg;
      } catch {
        /* fall through */
      }
    }
    return {
      username: "",
      tosAccepted: false,
      gamePath: "",
      autoStartBackend: true,
      serverMode: "host",
      backendHost: "127.0.0.1:3551",
      extraArgs: "",
      versions: [],
      mods: {},
      discordPresence: true,
      discordClientId: "",
      discordBot: true,
    };
  }
}

function getBackendBase() {
  const cfg = loadConfig();
  if (cfg.serverMode === "join" && cfg.backendHost) {
    let h = String(cfg.backendHost).trim();
    if (!h.startsWith("http")) h = `http://${h}`;
    return h.replace(/\/$/, "");
  }
  return "http://127.0.0.1:3551";
}

function shouldRunLocalBackend() {
  const cfg = loadConfig();
  return cfg.serverMode !== "join" && cfg.autoStartBackend !== false;
}

function getLanIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return "127.0.0.1";
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  return cfg;
}

// ---- Window ----
function createWindow() {
  win = new BrowserWindow({
    width: 980,
    height: 620,
    minWidth: 860,
    minHeight: 580,
    frame: false,
    backgroundColor: "#0a0a0a",
    resizable: true,
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("file:")) event.preventDefault();
  });
  win.webContents.on("did-fail-load", (_event, errorCode, _desc, url) => {
    if (url && !url.startsWith("file:")) return;
    if (errorCode === -2 || errorCode === -6) {
      win.loadFile(path.join(__dirname, "renderer", "index.html"));
    }
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

function isFortniteRunning() {
  if (process.platform !== "win32") return Promise.resolve(false);
  return isFortniteGameRunning();
}

function killFortniteProcesses() {
  const targets = [
    "FortniteClient-Win64-Shipping.exe",
    "FortniteClient-Win64-Shipping_EAC_EOS.exe",
    "FortniteClient-Win64-Shipping_EAC.exe",
    "FortniteLauncher.exe",
    "FortniteClient-Win64-Shipping_BE.exe",
  ];
  return Promise.all(
    targets.map(
      (image) =>
        new Promise((resolve) => {
          exec(`taskkill /F /IM ${image} /T`, { windowsHide: true }, () => resolve());
        })
    )
  );
}

async function fetchBackendPresence(accountId) {
  const base = getBackendBase();
  return new Promise((resolve) => {
    const req = http.get(`${base}/ogfn-panel/api/presence/${encodeURIComponent(accountId)}`, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data).state || "offline");
        } catch {
          resolve("offline");
        }
      });
    });
    req.on("error", () => resolve("offline"));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve("offline");
    });
  });
}

async function refreshDiscordPresence() {
  const cfg = loadConfig();
  if (cfg.discordPresence === false || !discordPresence.resolveClientId(cfg)) return;

  discordPresence.init(cfg);

  if (await isFortniteRunning()) {
    let state = "online";
    try {
      const accountId = await resolveAccountId();
      if (accountId) state = await fetchBackendPresence(accountId);
    } catch {
      /* backend offline — still show in-game */
    }
    await discordPresence.updateInGamePresence(cfg, state === "offline" ? "online" : state);
  } else {
    discordPresence.clearGameSession();
    await discordPresence.updateLauncherPresence(cfg, currentView);
  }
}

function startPresenceLoop() {
  refreshDiscordPresence();
  if (presenceTimer) clearInterval(presenceTimer);
  // Keep this light: each tick spawns a tasklist query, so poll sparingly.
  presenceTimer = setInterval(refreshDiscordPresence, 20000);
}

async function pollGameState() {
  const running = await isFortniteRunning();
  if (running === fortniteRunning) return;

  fortniteRunning = running;
  win?.webContents?.send("game:state", { running });

  if (!running) {
    stopGameserver();
    refreshDiscordPresence();
  }
}

function startGameWatch() {
  pollGameState();
  if (gameWatchTimer) clearInterval(gameWatchTimer);
  gameWatchTimer = setInterval(pollGameState, 3000);
}

app.whenReady().then(async () => {
  if (process.platform === "win32") app.setAppUserModelId("dev.velocity.launcher");
  ensureCerts();
  if (process.platform === "win32") {
    await netSetup.ensureUserCaTrusted(CERT_DIR);
  }
  if (shouldRunLocalBackend()) {
    await ensureBackendRunning();
    if (loadConfig().discordBot !== false) {
      discordBotHost.startDiscordBot({ resourcesPath: process.resourcesPath });
    }
  }
  createWindow();
  startPresenceLoop();
  startGameWatch();
});
app.on("window-all-closed", () => {
  discordBotHost.stopDiscordBot();
  if (backendProcess) backendProcess.kill();
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", async () => {
  discordBotHost.stopDiscordBot();
  if (presenceTimer) clearInterval(presenceTimer);
  if (gameWatchTimer) clearInterval(gameWatchTimer);
  await discordPresence.destroy();
});

// ---- Window controls ----
ipcMain.on("window:minimize", () => win?.minimize());
ipcMain.on("window:close", () => win?.close());
ipcMain.on("discord:setView", (_e, view) => {
  currentView = view || "home";
  refreshDiscordPresence();
});

// ---- Config IPC ----
ipcMain.handle("config:get", () => loadConfig());

ipcMain.handle("asset:resolve", (_e, relPath) => {
  if (!relPath || typeof relPath !== "string") return null;
  const normalized = relPath.replace(/^[/\\]+/, "").replace(/\.\./g, "");
  const file = path.join(__dirname, "renderer", normalized);
  if (!fs.existsSync(file)) return null;
  return pathToFileURL(file).href;
});
ipcMain.handle("config:save", (_e, partial) => {
  const cfg = saveConfig({ ...loadConfig(), ...partial });
  if ("discordPresence" in partial || "discordClientId" in partial) {
    discordPresence.destroy().then(() => refreshDiscordPresence());
  }
  return cfg;
});

// ---- Pick the Fortnite executable ----
ipcMain.handle("game:pick", async () => {
  const result = await dialog.showOpenDialog(win, {
    title: "Select FortniteClient-Win64-Shipping.exe",
    properties: ["openFile"],
    filters: [{ name: "Executable", extensions: ["exe"] }],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const cfg = saveConfig({ ...loadConfig(), gamePath: result.filePaths[0] });
  return cfg.gamePath;
});

// ---- Pick a custom background image (copied into the renderer folder) ----
ipcMain.handle("background:pick", async () => {
  const result = await dialog.showOpenDialog(win, {
    title: "Select a background image",
    properties: ["openFile"],
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
  });
  if (result.canceled || !result.filePaths[0]) return null;

  const src = result.filePaths[0];
  const ext = path.extname(src).toLowerCase() || ".png";
  const destName = `custom-bg${ext}`;
  const dest = path.join(__dirname, "renderer", destName);

  // Remove any previous custom background so we don't leave stale files.
  for (const e of [".png", ".jpg", ".jpeg", ".webp", ".gif"]) {
    const old = path.join(__dirname, "renderer", `custom-bg${e}`);
    if (fs.existsSync(old)) fs.rmSync(old);
  }
  fs.copyFileSync(src, dest);
  saveConfig({ ...loadConfig(), backgroundFile: destName });
  return destName;
});

// ---- Reset to the default background ----
ipcMain.handle("background:reset", () => {
  for (const e of [".png", ".jpg", ".jpeg", ".webp", ".gif"]) {
    const old = path.join(__dirname, "renderer", `custom-bg${e}`);
    if (fs.existsSync(old)) fs.rmSync(old);
  }
  saveConfig({ ...loadConfig(), backgroundFile: "" });
  return true;
});

// ---- Version library: locate the shipping exe inside a build folder ----
const SHIPPING_EXE = "FortniteClient-Win64-Shipping.exe";

function findShippingExe(root) {
  // Check the common known location first, then a shallow recursive scan.
  const known = path.join(root, "FortniteGame", "Binaries", "Win64", SHIPPING_EXE);
  if (fs.existsSync(known)) return known;

  const stack = [{ dir: root, depth: 0 }];
  while (stack.length) {
    const { dir, depth } = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isFile() && e.name.toLowerCase() === SHIPPING_EXE.toLowerCase()) return full;
      if (e.isDirectory() && depth < 4) stack.push({ dir: full, depth: depth + 1 });
    }
  }
  return null;
}

// Try to read a build name (e.g. "9.41") from folder name or splash files.
function guessVersionName(root, exePath) {
  const base = path.basename(root);
  const m = base.match(/(\d+\.\d+)/);
  if (m) return m[1];
  return base;
}

function getInstallRoot() {
  return path.join(app.getPath("documents"), "Velocity", "Builds");
}

function registerVersion(root, meta = {}) {
  const exePath = findShippingExe(root);
  const version = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: meta.build || guessVersionName(root, exePath),
    root,
    exePath: exePath || "",
    verified: !!exePath,
    seasonId: meta.seasonId || "",
    seasonLabel: meta.seasonLabel || "",
    chapter: meta.chapter || 0,
  };
  return version;
}

ipcMain.handle("version:add", async () => {
  const result = await dialog.showOpenDialog(win, {
    title: "Select your Fortnite build folder",
    properties: ["openDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) return null;

  const version = registerVersion(result.filePaths[0]);
  const cfg = loadConfig();
  const versions = Array.isArray(cfg.versions) ? cfg.versions : [];
  versions.push(version);
  saveConfig({ ...cfg, versions });
  return version;
});

// Easy install for a catalog season: create folder → pick/browse → verify → auto-select.
ipcMain.handle("version:installSeason", async (_e, season) => {
  if (!season?.id) return { ok: false, reason: "Invalid season." };

  const installDir = path.join(getInstallRoot(), season.folder || season.id);
  fs.mkdirSync(installDir, { recursive: true });

  const result = await dialog.showOpenDialog(win, {
    title: `Install ${season.label} (v${season.build})`,
    message: "Select the folder that contains FortniteClient-Win64-Shipping.exe, or the folder where you'll extract the build.",
    defaultPath: installDir,
    properties: ["openDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) {
    shell.openPath(installDir);
    return { ok: false, cancelled: true, folder: installDir };
  }

  const root = result.filePaths[0];
  const version = registerVersion(root, {
    seasonId: season.id,
    seasonLabel: season.label,
    build: season.build,
    chapter: season.chapter,
  });

  const cfg = loadConfig();
  let versions = (cfg.versions || []).filter((v) => v.seasonId !== season.id);
  versions.push(version);

  const patch = { ...cfg, versions };
  if (version.verified) {
    patch.selectedVersion = version.id;
    patch.gamePath = version.exePath;
  }
  saveConfig(patch);

  return {
    ok: true,
    verified: version.verified,
    version,
    folder: installDir,
  };
});

// ---- Full build download + install ----
// Community-hosted OG build archives. Each season lists mirrors tried in order.
// Override via config.buildManifest (string or array per season id).
const BUILD_MANIFEST = {
  c1s1: ["https://builds.rebootfn.org/1.11.zip", "https://public.simplyblk.xyz/1.11.zip"],
  c1s2: ["https://builds.rebootfn.org/2.5.0.rar", "https://public.simplyblk.xyz/2.5.0.rar"],
  c1s3: ["https://builds.rebootfn.org/3.5.rar", "https://public.simplyblk.xyz/3.5.rar"],
  c1s4: ["https://builds.rebootfn.org/4.5.rar", "https://public.simplyblk.xyz/4.5.rar"],
  c1s5: [
    "https://fn-builds.repressoh.it/5.41.zip",
    "https://public.simplyblk.xyz/5.41.zip",
    "https://archive.org/download/Fortnite-5.41-CL-4363240.zip/5.41-CL-4363240.zip",
  ],
  c1s6: ["https://builds.rebootfn.org/6.31.rar", "https://public.simplyblk.xyz/6.31.rar"],
  c1s7: ["https://builds.rebootfn.org/7.40.rar", "https://public.simplyblk.xyz/7.40.rar"],
  c1s8: ["https://builds.rebootfn.org/8.51.rar", "https://public.simplyblk.xyz/8.51.rar"],
  c1s9: ["https://builds.rebootfn.org/9.41.rar", "https://public.simplyblk.xyz/9.41.rar"],
  c1sx: [
    "https://public.simplyblk.xyz/10.40.rar",
    "https://archive.org/download/Fortnite-10.40-CL-9380822.rar/10.40-CL-9380822.rar",
  ],
  c1og: [
    "https://fn-builds.repressoh.it/27.11-CL-29739262.7z",
    "https://gofile.io/d/MfJHqg",
  ],

  c2s1: ["https://fn-builds.repressoh.it/11.31.rar", "https://public.simplyblk.xyz/11.31.rar"],
  c2s2: [
    "https://fn-builds.repressoh.it/12.41-CL-12905909-Windows.zip",
    "https://public.simplyblk.xyz/Fortnite%2012.41.zip",
    "https://cdn.aufgeladen.dev/12.41.zip",
  ],
  c2s3: ["https://fn-builds.repressoh.it/13.40.zip", "https://public.simplyblk.xyz/13.40.zip"],
  c2s4: [
    "https://fn-builds.repressoh.it/14.60.rar",
    "https://public.simplyblk.xyz/14.60.rar",
    "https://buzzheavier.com/5deub93f6csc",
  ],
  c2s5: [
    "https://fn-builds.repressoh.it/15.30.zip",
    "https://public.simplyblk.xyz/15.30.rar",
    "https://r2.ploosh.dev/15.30.zip",
  ],
  c2s6: ["https://fn-builds.repressoh.it/16.40.zip", "https://public.simplyblk.xyz/16.40.rar"],
  c2s7: ["https://fn-builds.repressoh.it/17.50.zip", "https://public.simplyblk.xyz/17.50.zip"],
  c2s8: [
    "https://fn-builds.repressoh.it/18.40-CL-18163738-Windows.zip",
    "https://public.simplyblk.xyz/18.40.zip",
  ],
  c2remix: [
    "https://fn-builds.repressoh.it/32.11-CL-38371047.rar",
    "https://www.dropbox.com/scl/fi/5djmb3ll3j1nghszjfsy0/32.11-CL-38371047.rar?rlkey=skt5ix1svq2xvj1kai8wf9jew&dl=1",
  ],

  c3s1: [
    "https://fn-builds.repressoh.it/19.10.rar",
    "https://public.simplyblk.xyz/19.10.rar",
    "https://crystal.ploosh.dev/19.10.zip",
  ],
  c3s2: ["https://fn-builds.repressoh.it/20.40-CL-20244966.zip", "https://public.simplyblk.xyz/20.40.zip"],
  c3s3: [
    "https://fn-builds.repressoh.it/21.10.zip",
    "https://public.simplyblk.xyz/21.10.zip",
    "https://r2.ploosh.dev/21.00.zip",
  ],
  c3s4: ["https://fn-builds.repressoh.it/22.00.7z", "https://public.simplyblk.xyz/22.00.7z"],

  c4s1: [
    "https://fn-builds.repressoh.it/23.10-CL-23443094.rar",
    "https://fn-builds.repressoh.it/23.00.7z",
  ],
  c4s2: [
    "https://fn-builds.repressoh.it/24.20-CL-25156858.zip",
    "https://r2.ploosh.dev/24.20.zip",
    "https://r2.kovryn.xyz/24.20.zip",
  ],
  c4s3: ["https://fn-builds.repressoh.it/25.11.zip", "https://r2.ploosh.dev/25.11.zip"],
  c4s4: [
    "https://fn-builds.repressoh.it/26.30-CL-28688692.zip",
    "https://r2.ploosh.dev/26.30.zip",
    "http://r2.ploosh.dev/26.30-CL-28688692.zip",
  ],

  c5s1: [
    "https://fn-builds.repressoh.it/28.30-CL-31511038.7z",
    "https://gofile.io/d/pIYSae",
  ],
  c5s2: [
    "https://fn-builds.repressoh.it/29.00-CL-32116959.7z",
    "https://gofile.io/d/cw0eee",
  ],
  c5s3: [
    "https://fn-builds.repressoh.it/30.00-CL-33962396.rar",
    "https://gofile.io/d/ZjRYts",
  ],
};

function getBuildUrls(seasonId) {
  const cfg = loadConfig();
  const override = (cfg.buildManifest || {})[seasonId];
  const urls = override || BUILD_MANIFEST[seasonId] || [];
  return Array.isArray(urls) ? urls : [urls];
}

// seasonId -> { cancelled, res, file, child, zipPath }
const activeDownloads = new Map();

function sendSeasonProgress(seasonId, payload) {
  win?.webContents.send("season:progress", { seasonId, ...payload });
}

function cleanupDownload(seasonId, { deleteZip = true } = {}) {
  const dl = activeDownloads.get(seasonId);
  if (!dl) return;
  try { dl.res?.destroy(); } catch { /* already closed */ }
  try { dl.file?.close(); } catch { /* already closed */ }
  try { dl.child?.kill(); } catch { /* already dead */ }
  if (deleteZip && dl.zipPath && fs.existsSync(dl.zipPath)) {
    try { fs.rmSync(dl.zipPath); } catch { /* locked; leave it */ }
  }
  activeDownloads.delete(seasonId);
}

function resolveBuzzheavier(pageUrl) {
  return new Promise((resolve) => {
    const base = pageUrl.replace(/\/?$/, "/");
    const reqUrl = `${base}download`;
    https
      .get(
        reqUrl,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Referer: base,
            "hx-current-url": base,
            Accept: "*/*",
          },
        },
        (res) => {
          const hx = res.headers["hx-redirect"] || res.headers["Hx-Redirect"];
          const loc = res.headers.location;
          res.resume();
          if (hx && hx !== "None") {
            if (hx.startsWith("http")) return resolve(hx);
            try {
              const host = new URL(base).hostname;
              return resolve(`https://${host}${hx.startsWith("/") ? hx : `/${hx}`}`);
            } catch {
              return resolve(null);
            }
          }
          if (loc?.startsWith("http")) return resolve(loc);
          resolve(null);
        }
      )
      .on("error", () => resolve(null));
  });
}

async function resolveDownloadUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname === "buzzheavier.com" && !u.pathname.endsWith("/download")) {
      const direct = await resolveBuzzheavier(url);
      if (direct) return direct;
    }
  } catch {
    /* keep original url */
  }
  return url;
}

function downloadToFile(url, dest, seasonId, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error("Too many redirects"));
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "*/*",
        },
      },
      (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(downloadToFile(new URL(res.headers.location, url).href, dest, seasonId, redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`Server returned ${res.statusCode}`));
      }

      const total = parseInt(res.headers["content-length"] || "0", 10);
      const file = fs.createWriteStream(dest);
      const dl = activeDownloads.get(seasonId);
      if (dl) {
        dl.res = res;
        dl.file = file;
      }

      let received = 0;
      let lastEmit = 0;
      let lastBytes = 0;
      let lastDataAt = Date.now();
      const stallMs = 45000;
      const stallTimer = setInterval(() => {
        if (Date.now() - lastDataAt < stallMs) return;
        clearInterval(stallTimer);
        try { req.destroy(); } catch { /* already closed */ }
        try { file.close(); } catch { /* already closed */ }
        reject(new Error("Download stalled — trying next mirror…"));
      }, 5000);

      const emitProgress = (force = false) => {
        const now = Date.now();
        if (!force && now - lastEmit < 500) return;
        const speed = ((received - lastBytes) / ((now - lastEmit) / 1000)) || 0;
        sendSeasonProgress(seasonId, {
          phase: "downloading",
          received,
          total,
          pct: total ? Math.round((received / total) * 100) : 0,
          speedBps: Math.round(speed),
        });
        lastEmit = now;
        lastBytes = received;
      };

      res.on("data", (chunk) => {
        received += chunk.length;
        lastDataAt = Date.now();
        emitProgress();
      });

      res.pipe(file);
      file.on("finish", () => {
        clearInterval(stallTimer);
        file.close(() => resolve({ received, total }));
      });
      file.on("error", (err) => {
        clearInterval(stallTimer);
        reject(err);
      });
      res.on("error", (err) => {
        clearInterval(stallTimer);
        reject(err);
      });
      res.on("aborted", () => {
        clearInterval(stallTimer);
        reject(new Error("Download cancelled"));
      });
      emitProgress(true);
    });
    req.on("error", (err) => reject(err));
    req.setTimeout(120000, () => {
      try { req.destroy(); } catch { /* already closed */ }
      reject(new Error("Connection timed out — trying next mirror…"));
    });
  });
}

function findSevenZip() {
  return ["C:\\Program Files\\7-Zip\\7z.exe", "C:\\Program Files (x86)\\7-Zip\\7z.exe"].find(fs.existsSync);
}

function readFileHeader(filePath, len = 16) {
  const fd = fs.openSync(filePath, "r");
  const buf = Buffer.alloc(len);
  fs.readSync(fd, buf, 0, len, 0);
  fs.closeSync(fd);
  return buf;
}

function detectArchiveExt(buf) {
  if (buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b) return ".zip";
  if (buf.length >= 4 && buf.toString("ascii", 0, 4) === "Rar!") return ".rar";
  if (buf.length >= 6 && buf.toString("ascii", 0, 6) === "7z\xBC\xAF\x27\x1C") return ".7z";
  const text = buf.toString("utf8", 0, Math.min(buf.length, 32)).trim().toLowerCase();
  if (text.startsWith("<!doctype") || text.startsWith("<html") || text.startsWith("<")) return null;
  return null;
}

function prepareDownloadedArchive(filePath) {
  const stat = fs.statSync(filePath);
  if (stat.size < 50 * 1024 * 1024) {
    fs.rmSync(filePath, { force: true });
    throw new Error("Download too small to be a full Fortnite build (mirror may be broken).");
  }
  const header = readFileHeader(filePath, 16);
  const detected = detectArchiveExt(header);
  if (!detected) {
    fs.rmSync(filePath, { force: true });
    throw new Error("Mirror returned a web page instead of a game archive.");
  }
  const current = path.extname(filePath).toLowerCase();
  if (current !== detected) {
    const fixed = filePath.slice(0, -current.length) + detected;
    fs.renameSync(filePath, fixed);
    return fixed;
  }
  return filePath;
}

function findExtractor(ext) {
  const sevenZip = findSevenZip();
  if (sevenZip) {
    return {
      cmd: sevenZip,
      args: (src, dest) => ["x", "-y", `-o${dest.endsWith("\\") ? dest : `${dest}\\`}`, src],
    };
  }
  if (ext === ".zip") {
    return { cmd: "tar", args: (src, dest) => ["-xf", src, "-C", dest] };
  }
  const unrar = ["C:\\Program Files\\WinRAR\\UnRAR.exe", "C:\\Program Files (x86)\\WinRAR\\UnRAR.exe"].find(fs.existsSync);
  if (unrar) return { cmd: unrar, args: (src, dest) => ["x", "-y", src, dest.endsWith("\\") ? dest : dest + "\\"] };
  return null;
}

function archiveExtForUrl(url, season) {
  if (season?.archiveExt) return season.archiveExt;
  const pathname = new URL(url).pathname.toLowerCase();
  if (pathname.endsWith(".zip")) return ".zip";
  if (pathname.endsWith(".rar")) return ".rar";
  if (pathname.endsWith(".7z")) return ".7z";
  return ".zip";
}

function extractArchive(archivePath, destDir, seasonId) {
  return new Promise((resolve, reject) => {
    sendSeasonProgress(seasonId, { phase: "extracting" });
    const ext = path.extname(archivePath).toLowerCase();
    const extractor = findExtractor(ext);
    if (!extractor) {
      const hint =
        ext === ".7z" || ext === ".rar"
          ? "Install 7-Zip (https://www.7-zip.org/) to extract this build, then retry or use Locate."
          : `Install 7-Zip to extract this ${ext} archive, then retry or use Locate.`;
      return reject(new Error(hint));
    }
    const child = spawn(extractor.cmd, extractor.args(archivePath, destDir), { windowsHide: true });
    const dl = activeDownloads.get(seasonId);
    if (dl) dl.child = child;
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("exit", (code) => {
      const msg = stderr.trim();
      if (code === 0) return resolve();
      if (/unrecognized archive format/i.test(msg)) {
        return reject(new Error("Download is not a valid archive — try Locate if you already have the build."));
      }
      reject(new Error(msg || `Extraction failed (code ${code})`));
    });
  });
}

ipcMain.handle("version:downloadSeason", async (_e, season) => {
  if (!season?.id) return { ok: false, reason: "Invalid season." };
  if (activeDownloads.has(season.id)) return { ok: false, reason: "Already downloading." };

  const urls = getBuildUrls(season.id);
  if (!urls.length) return { ok: false, reason: "No download available for this season." };

  const installDir = path.join(getInstallRoot(), season.folder || season.id);
  fs.mkdirSync(installDir, { recursive: true });

  activeDownloads.set(season.id, { cancelled: false, zipPath: null });

  try {
    sendSeasonProgress(season.id, { phase: "starting" });

    // Try each mirror until one works.
    let zipPath = null;
    let lastErr = null;
    for (const url of urls) {
      const resolved = await resolveDownloadUrl(url);
      const ext = archiveExtForUrl(resolved, season);
      const candidate = path.join(getInstallRoot(), `${season.folder || season.id}${ext}`);
      const dl = activeDownloads.get(season.id);
      if (!dl || dl.cancelled) throw new Error("Download cancelled");
      dl.zipPath = candidate;
      try {
        await downloadToFile(resolved, candidate, season.id);
        zipPath = prepareDownloadedArchive(candidate);
        break;
      } catch (err) {
        lastErr = err;
        if (/cancelled/i.test(err.message)) throw err;
        try { fs.rmSync(candidate); } catch { /* not created */ }
      }
    }
    if (!zipPath) throw lastErr || new Error("All download mirrors failed — try Locate if you already have the build.");

    if (activeDownloads.get(season.id)?.cancelled) throw new Error("Download cancelled");

    await extractArchive(zipPath, installDir, season.id);
    try { fs.rmSync(zipPath); } catch { /* leave partial zip */ }

    sendSeasonProgress(season.id, { phase: "verifying" });
    const version = registerVersion(installDir, {
      seasonId: season.id,
      seasonLabel: season.label,
      build: season.build,
      chapter: season.chapter,
    });

    if (!version.verified) {
      throw new Error("Extracted files are missing FortniteClient-Win64-Shipping.exe");
    }

    const cfg = loadConfig();
    const versions = (cfg.versions || []).filter((v) => v.seasonId !== season.id);
    versions.push(version);
    saveConfig({ ...cfg, versions, selectedVersion: version.id, gamePath: version.exePath });

    activeDownloads.delete(season.id);
    sendSeasonProgress(season.id, { phase: "done" });
    return { ok: true, version };
  } catch (err) {
    const cancelled = activeDownloads.get(season.id)?.cancelled || /cancelled/i.test(err.message);
    cleanupDownload(season.id);
    sendSeasonProgress(season.id, { phase: cancelled ? "cancelled" : "error", reason: err.message });
    return { ok: false, cancelled, reason: err.message };
  }
});

ipcMain.handle("version:cancelDownload", (_e, seasonId) => {
  const dl = activeDownloads.get(seasonId);
  if (!dl) return { ok: false };
  dl.cancelled = true;
  cleanupDownload(seasonId);
  sendSeasonProgress(seasonId, { phase: "cancelled" });
  return { ok: true };
});

ipcMain.handle("version:openFolder", (_e, id) => {
  const cfg = loadConfig();
  const v = (cfg.versions || []).find((x) => x.id === id);
  if (!v?.root) return { ok: false };
  shell.openPath(v.root);
  return { ok: true };
});

ipcMain.handle("version:verify", (_e, id) => {
  const cfg = loadConfig();
  const versions = cfg.versions || [];
  const v = versions.find((x) => x.id === id);
  if (!v) return { ok: false };
  const exePath = findShippingExe(v.root);
  v.exePath = exePath || "";
  v.verified = !!exePath;
  saveConfig({ ...cfg, versions });
  return { ok: v.verified, version: v };
});

ipcMain.handle("version:select", (_e, id) => {
  const cfg = loadConfig();
  const versions = cfg.versions || [];
  const v = versions.find((x) => x.id === id);
  if (!v || !v.verified) return { ok: false };
  saveConfig({ ...cfg, versions, selectedVersion: id, gamePath: v.exePath });
  return { ok: true };
});

ipcMain.handle("version:remove", (_e, id) => {
  const cfg = loadConfig();
  let versions = cfg.versions || [];
  versions = versions.filter((x) => x.id !== id);
  const patch = { ...cfg, versions };
  if (cfg.selectedVersion === id) {
    patch.selectedVersion = "";
    patch.gamePath = "";
  }
  saveConfig(patch);
  return { ok: true };
});

// ---- Announcement (pulled from the backend MOTD, with a fallback) ----
ipcMain.handle("announcement:get", async () => {
  const base = getBackendBase();
  return new Promise((resolve) => {
    const req = http.get(`${base}/ogfn-panel/api/motd`, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          const m = JSON.parse(data);
          resolve({ online: true, text: m.enabled ? m.text : "" });
        } catch {
          resolve({ online: true, text: "" });
        }
      });
    });
    req.on("error", () =>
      resolve({ online: false, text: "Backend offline. Start Velocity or enable auto-start in settings." })
    );
    req.setTimeout(1500, () => {
      req.destroy();
      resolve({ online: false, text: "Backend offline. Start Velocity or enable auto-start in settings." });
    });
  });
});

// ---- Small HTTP helper (GET/POST JSON to the backend) ----
function backendRequest(method, pathName, body) {
  const base = getBackendBase();
  return new Promise((resolve, reject) => {
    const url = new URL(base + pathName);
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        method,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        headers: {
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data || "{}"));
          } catch {
            resolve({});
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(2500, () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

// Resolve the current username to a stable backend account id.
async function resolveAccountId() {
  const cfg = loadConfig();
  const name = cfg.username || "VelocityPlayer";
  const r = await backendRequest("GET", `/account/api/public/account/displayName/${encodeURIComponent(name)}`);
  return r.id || null;
}

ipcMain.handle("account:resolve", async () => {
  try {
    return await resolveAccountId();
  } catch {
    return null;
  }
});

ipcMain.handle("cosmetics:grant", async (_e, templateId) => {
  try {
    const accountId = await resolveAccountId();
    if (!accountId) return { ok: false, reason: "Backend offline — start it first." };
    // Ensure the athena profile exists before granting.
    await backendRequest(
      "POST",
      `/fortnite/api/game/v2/profile/${accountId}/client/QueryProfile?profileId=athena&rvn=-1`,
      {}
    );
    return await backendRequest("POST", "/ogfn-panel/api/grant", { accountId, templateId });
  } catch {
    return { ok: false, reason: "Backend offline — start it first." };
  }
});

ipcMain.handle("cosmetics:grantAll", async (_e, templateIds) => {
  try {
    const accountId = await resolveAccountId();
    if (!accountId) return { ok: false, reason: "Backend offline — start it first." };
    await backendRequest(
      "POST",
      `/fortnite/api/game/v2/profile/${accountId}/client/QueryProfile?profileId=athena&rvn=-1`,
      {}
    );
    return await backendRequest("POST", "/ogfn-panel/api/grant-all", { accountId, templateIds });
  } catch {
    return { ok: false, reason: "Backend offline — start it first." };
  }
});

ipcMain.handle("cosmetics:vbucks", async (_e, amount) => {
  try {
    const accountId = await resolveAccountId();
    if (!accountId) return { ok: false, reason: "Backend offline — start it first." };
    await backendRequest(
      "POST",
      `/fortnite/api/game/v2/profile/${accountId}/client/QueryProfile?profileId=common_core&rvn=-1`,
      {}
    );
    return await backendRequest("POST", "/ogfn-panel/api/vbucks", { accountId, amount });
  } catch {
    return { ok: false, reason: "Backend offline — start it first." };
  }
});

// ---- Cosmetics catalog (Season 1 → Chapter 2 Season 4) ----
let cosmeticsCatalogCache = null;

function fetchHttpsJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "Velocity/1.0" } }, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", reject)
      .setTimeout(15000, () => reject(new Error("timeout")));
  });
}

function introInCatalogRange(intro) {
  if (!intro?.chapter) return false;
  const ch = parseInt(intro.chapter, 10);
  const s = parseInt(intro.season, 10);
  if (ch >= 1 && ch <= 5) return true;
  return false;
}

function mapCosmeticType(typeValue) {
  if (typeValue === "outfit") return "skin";
  return typeValue;
}

ipcMain.handle("cosmetics:catalog", async () => {
  if (cosmeticsCatalogCache) return { ok: true, items: cosmeticsCatalogCache };

  try {
    const json = await fetchHttpsJson("https://fortnite-api.com/v2/cosmetics/br");
    const allowed = new Set(["outfit", "pickaxe", "glider", "emote"]);

    cosmeticsCatalogCache = (json.data || [])
      .filter((c) => allowed.has(c.type?.value) && introInCatalogRange(c.introduction) && c.images?.icon)
      .map((c) => ({
        name: c.name,
        type: mapCosmeticType(c.type.value),
        templateId: `${c.type.backendValue}:${c.id}`,
        icon: c.images.icon,
        chapter: parseInt(c.introduction.chapter, 10),
        season: parseInt(c.introduction.season, 10),
        rarity: c.rarity?.displayValue || "",
      }))
      .sort((a, b) => a.chapter - b.chapter || a.season - b.season || a.name.localeCompare(b.name));

    return { ok: true, items: cosmeticsCatalogCache };
  } catch (e) {
    return { ok: false, reason: "Could not load cosmetics catalog. Check your internet connection." };
  }
});

// ---- Backend status ----
function pingBackend() {
  const base = getBackendBase();
  return new Promise((resolve) => {
    const req = http.get(`${base}/fortnite/api/version`, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1200, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function pingHttp80Backend() {
  return new Promise((resolve) => {
    const req = http.get("http://127.0.0.1:8080/fortnite/api/version", (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1200, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function pingHttpsBackend() {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: "127.0.0.1",
        port: 8443,
        path: "/fortnite/api/version",
        method: "GET",
        rejectUnauthorized: false,
        timeout: 1200,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      }
    );
    req.on("error", () => resolve(false));
    req.setTimeout(1200, () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}
ipcMain.handle("backend:status", () => pingBackend());

function stopBackend() {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
}

function startBackend() {
  if (backendProcess || !shouldRunLocalBackend()) return;
  const indexPath = path.join(getBackendDir(), "index.js");
  if (!fs.existsSync(indexPath)) {
    console.error("Backend not found at", indexPath);
    return;
  }
  backendProcess = spawn(process.execPath, [indexPath], {
    cwd: getBackendDir(),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      VELOCITY_CERT_DIR: CERT_DIR,
      VELOCITY_PROFILE_DIR: path.join(app.getPath("userData"), "profiles"),
      VELOCITY_USER_DATA: app.getPath("userData"),
      VELOCITY_GAME_PATH: loadConfig().gamePath || "",
      VELOCITY_USERNAME: loadConfig().username || "",
      VELOCITY_GAMESERVER_DLL: loadConfig().gameserverDll || "",
      VELOCITY_CUSTOM_PAK_DIR: path.join(app.getPath("userData"), "custom-paks"),
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });
  backendProcess.stdout?.on("data", (d) => process.stdout.write(d));
  backendProcess.stderr?.on("data", (d) => process.stderr.write(d));
  backendProcess.on("exit", () => (backendProcess = null));
}

async function ensureBackendRunning() {
  if (!shouldRunLocalBackend()) return true;
  if ((await pingBackend()) && (await pingHttpsBackend()) && (await pingHttp80Backend())) {
    return true;
  }
  startBackend();
  return waitForBackend();
}

function restartBackend() {
  stopBackend();
  startBackend();
}

async function waitForBackend() {
  for (let i = 0; i < 25; i++) {
    if ((await pingBackend()) && (await pingHttpsBackend()) && (await pingHttp80Backend())) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function buildLaunchArgs(cfg) {
  const { args } = await buildGameLaunchArgs({
    cfg,
    shippingExe: cfg.gamePath,
    backendBase: getBackendBase(),
  });
  return args;
}

ipcMain.handle("server:info", () => {
  const cfg = loadConfig();
  return {
    mode: cfg.serverMode || "host",
    lanIp: getLanIp(),
    httpPort: 3551,
    xmppPort: 80,
    backendBase: getBackendBase(),
    shareAddress: `${getLanIp()}:3551`,
    shareNote: "Friends: Settings → Join friend's server → enter this address. Host must run Set up connection as Administrator.",
  };
});
ipcMain.handle("backend:start", async () => {
  ensureCerts();
  return ensureBackendRunning();
});

// ---- Game connection setup (WinInet redirect) ----
function ensureCerts() {
  try {
    const backendDir = getBackendDir();
    const backendModules = path.join(backendDir, "node_modules");
    if (fs.existsSync(backendModules) && !module.paths.includes(backendModules)) {
      module.paths.unshift(backendModules);
    }
    const certs = require(path.join(backendDir, "structs", "certs.js"));
    const versionFile = path.join(CERT_DIR, ".cert-version");
    const prevVersion = fs.existsSync(versionFile) ? fs.readFileSync(versionFile, "utf8").trim() : null;
    certs.ensureCerts(CERT_DIR);
    const nextVersion = fs.existsSync(versionFile) ? fs.readFileSync(versionFile, "utf8").trim() : null;
    if (prevVersion && nextVersion && prevVersion !== nextVersion && shouldRunLocalBackend()) {
      restartBackend();
    }
    return fs.existsSync(path.join(CERT_DIR, "velocity-ca.crt"));
  } catch (err) {
    console.error("Cert generation failed:", err.message);
    return false;
  }
}

function getRedirectTargetIp() {
  const cfg = loadConfig();
  if (cfg.serverMode === "join" && cfg.backendHost) {
    const ip = String(cfg.backendHost).replace(/^https?:\/\//, "").split(":")[0].trim();
    if (ip) return ip;
  }
  return "127.0.0.1";
}

ipcMain.handle("net:status", async () => {
  const cfg = loadConfig();
  return netSetup.status({ joinMode: cfg.serverMode === "join", certDir: CERT_DIR });
});
ipcMain.handle("net:setup", async () => {
  if (!ensureCerts()) {
    return {
      ok: false,
      reason:
        "Could not create the local certificate. Close Velocity completely, reopen it, then click Set up connection again.",
    };
  }
  const cfg = loadConfig();
  const hostMode = cfg.serverMode !== "join";
  const res = await netSetup.applySetup({
    certDir: CERT_DIR,
    backendDir: getBackendDir(),
    targetIp: getRedirectTargetIp(),
    hostMode,
  });
  if (res.ok && shouldRunLocalBackend()) restartBackend();
  return res;
});
ipcMain.handle("net:manualSetup", async () => {
  if (!ensureCerts()) {
    return { ok: false, reason: "Could not create the local certificate. Restart Velocity and try again." };
  }
  const cfg = loadConfig();
  const res = await netSetup.openManualSetup({
    certDir: CERT_DIR,
    backendDir: getBackendDir(),
    targetIp: getRedirectTargetIp(),
    hostMode: cfg.serverMode !== "join",
  });
  if (res.ok && res.batPath) {
    shell.showItemInFolder(res.batPath);
  }
  return res;
});
ipcMain.handle("net:teardown", async () => netSetup.removeSetup());

ipcMain.handle("game:kill", async () => {
  const wasRunning = await isFortniteRunning();
  stopGameserver();
  await killFortniteProcesses();
  await new Promise((r) => setTimeout(r, 400));
  const stillRunning = await isFortniteRunning();
  fortniteRunning = stillRunning;
  win?.webContents?.send("game:state", { running: stillRunning });
  refreshDiscordPresence();
  return {
    ok: !stillRunning,
    wasRunning,
    reason: stillRunning ? "Fortnite is still running. Try again." : wasRunning ? "Fortnite closed." : "Fortnite is not running.",
  };
});

ipcMain.handle("game:running", () => isFortniteRunning());

// ---- Launch the game ----
ipcMain.handle("game:launch", async () => {
  const cfg = loadConfig();
  if (!cfg.gamePath || !fs.existsSync(cfg.gamePath)) {
    return { ok: false, reason: "Fortnite executable not set. Open Settings and select it." };
  }

  // The game must be able to reach the backend over the redirected Epic domains.
  ensureCerts();
  await netSetup.ensureUserCaTrusted(CERT_DIR);
  const net = await netSetup.status({ joinMode: cfg.serverMode === "join", certDir: CERT_DIR });
  if (!net.ready) {
    const hint = net.certStale
      ? "Your security certificate is out of date. Close Velocity, reopen it, then try Play again. If it still fails, run Set up connection as Administrator."
      : net.hostsIpv6Broken
        ? "Your hosts file has broken IPv6 Epic redirects (shows the Epic login screen). Open Settings → Game connection → Set up connection again as Administrator."
      : net.hostsStale
      ? "Your hosts file still redirects Caldera to localhost (breaks Chapter 4+). Open Settings → Game connection → Set up connection again as Administrator."
      : net.hostsBroken
      ? "Your hosts file needs repair. Open Settings → Game connection → Set up connection again."
      : !net.portproxyOk && cfg.serverMode !== "join"
        ? "Port forwarding (443→8443) is missing. Run Set up connection again as Administrator."
        : "One-time setup needed so Fortnite can connect. Click \u201CSet up connection\u201D and approve the Administrator prompt.";
    return { ok: false, needsSetup: true, reason: hint };
  }

  if (shouldRunLocalBackend()) {
    if (!(await ensureBackendRunning())) {
      return {
        ok: false,
        reason:
          "Backend is not running (ports 3551, 8080, 8443). Close Velocity completely and reopen it, then try Play again.",
      };
    }
    // Keep backend gameserver config in sync with the selected build.
    try {
      const http = require("http");
      await new Promise((resolve) => {
        const body = JSON.stringify({
          gameserver: {
            gamePath: cfg.gamePath,
            dllPath: cfg.gameserverDll || "",
            autoStart: true,
          },
        });
        const req = http.request(
          {
            hostname: "127.0.0.1",
            port: 3551,
            path: "/ogfn-panel/api/config",
            method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
          },
          () => resolve()
        );
        req.on("error", () => resolve());
        req.write(body);
        req.end();
      });
    } catch {
      /* optional sync */
    }
  } else if (!(await pingBackend())) {
    return { ok: false, reason: "Cannot reach the host server. Check the IP in Settings." };
  }

  const username = cfg.username || "VelocityPlayer";
  const args = await buildLaunchArgs(cfg);
  const build = resolveBuildNumber(cfg, cfg.gamePath);

  try {
    fs.writeFileSync(
      path.join(app.getPath("userData"), "last-launch-args.txt"),
      `[${new Date().toISOString()}] build=${build}\n${args.join(" ")}\n`
    );
  } catch {
    /* ignore */
  }

  const pakInstall = installCustomPaks(cfg.gamePath);
  if (pakInstall.installed?.length) {
    console.log(`[Velocity] Installed custom paks: ${pakInstall.installed.join(", ")}`);
  }

  try {
    // Gameserver is started by the backend when you queue — not here.
    // Starting it on Play blocked launch (~90s) and then got killed by launchFortnite.
    await launchFortnite(cfg.gamePath, args, {
      stubCacheDir: path.join(app.getPath("userData"), "cache"),
      certDir: CERT_DIR,
      cfg,
      waitUntilRunning: build < 23,
    });
    pollGameState();
    refreshDiscordPresence();
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
});

ipcMain.on("external:open", (_e, url) => shell.openExternal(url));
