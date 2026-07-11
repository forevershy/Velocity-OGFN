const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ogfn", {
  // Window controls
  minimize: () => ipcRenderer.send("window:minimize"),
  close: () => ipcRenderer.send("window:close"),

  // Config
  getConfig: () => ipcRenderer.invoke("config:get"),
  saveConfig: (partial) => ipcRenderer.invoke("config:save", partial),
  resolveAsset: (relPath) => ipcRenderer.invoke("asset:resolve", relPath),

  // Game
  pickGame: () => ipcRenderer.invoke("game:pick"),
  launch: () => ipcRenderer.invoke("game:launch"),
  killGame: () => ipcRenderer.invoke("game:kill"),
  isGameRunning: () => ipcRenderer.invoke("game:running"),
  onGameState: (cb) => ipcRenderer.on("game:state", (_e, data) => cb(data)),

  // Background
  pickBackground: () => ipcRenderer.invoke("background:pick"),
  resetBackground: () => ipcRenderer.invoke("background:reset"),

  // Account / cosmetics
  resolveAccount: () => ipcRenderer.invoke("account:resolve"),
  grantCosmetic: (templateId) => ipcRenderer.invoke("cosmetics:grant", templateId),
  grantAllCosmetics: (templateIds) => ipcRenderer.invoke("cosmetics:grantAll", templateIds),
  setVbucks: (amount) => ipcRenderer.invoke("cosmetics:vbucks", amount),
  getCosmeticsCatalog: () => ipcRenderer.invoke("cosmetics:catalog"),

  // Version library
  addVersion: () => ipcRenderer.invoke("version:add"),
  installSeason: (season) => ipcRenderer.invoke("version:installSeason", season),
  downloadSeason: (season) => ipcRenderer.invoke("version:downloadSeason", season),
  cancelDownload: (seasonId) => ipcRenderer.invoke("version:cancelDownload", seasonId),
  onSeasonProgress: (cb) => ipcRenderer.on("season:progress", (_e, data) => cb(data)),
  openVersionFolder: (id) => ipcRenderer.invoke("version:openFolder", id),
  verifyVersion: (id) => ipcRenderer.invoke("version:verify", id),
  selectVersion: (id) => ipcRenderer.invoke("version:select", id),
  removeVersion: (id) => ipcRenderer.invoke("version:remove", id),

  // Backend
  backendStatus: () => ipcRenderer.invoke("backend:status"),
  startBackend: () => ipcRenderer.invoke("backend:start"),
  serverInfo: () => ipcRenderer.invoke("server:info"),

  // Misc
  getAnnouncement: () => ipcRenderer.invoke("announcement:get"),
  openExternal: (url) => ipcRenderer.send("external:open", url),
  setDiscordView: (view) => ipcRenderer.send("discord:setView", view),

  // Game connection (WinInet redirect)
  netStatus: () => ipcRenderer.invoke("net:status"),
  setupNet: () => ipcRenderer.invoke("net:setup"),
  manualSetupNet: () => ipcRenderer.invoke("net:manualSetup"),
  teardownNet: () => ipcRenderer.invoke("net:teardown"),
});
