const $ = (sel) => document.querySelector(sel);

function toast(msg, kind = "ok") {
  const el = $("#toast");
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  setTimeout(() => (el.className = "toast"), 2800);
}

// ---- Window controls ----
$("#btnMin").addEventListener("click", () => window.ogfn.minimize());
$("#btnClose").addEventListener("click", () => window.ogfn.close());

$("#railKill").addEventListener("click", async () => {
  const btn = $("#railKill");
  btn.disabled = true;
  const r = await window.ogfn.killGame();
  btn.disabled = false;
  gameRunning = false;
  launchPending = false;
  toast(r.reason, r.ok || !r.wasRunning ? "ok" : "err");
  refreshLaunchBar();
  refreshAnnouncement();
});

let config = {};
let notifPref = "all";
let launchPending = false;
let gameRunning = false;

// ---- Background ----
function applyBackground() {
  const file = config.backgroundFile;
  const value = file ? `url("${file}?t=${Date.now()}")` : 'url("custom-bg.webp")';
  document.documentElement.style.setProperty("--stage-bg", value);
  const input = document.querySelector("#setBackground");
  if (input) input.value = file || "Default background";
}

// ---- Onboarding ----
let step = 0;
const steps = document.querySelectorAll(".ob-step");
const dots = document.querySelectorAll(".dots .dot");

const LAST_STEP = steps.length - 1;

// Populate the date-of-birth dropdowns.
function initDob() {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthSel = $("#dobMonth");
  const daySel = $("#dobDay");
  const yearSel = $("#dobYear");
  monthSel.innerHTML = '<option value="">Month</option>' + months.map((m, i) => `<option value="${i + 1}">${m}</option>`).join("");
  daySel.innerHTML = '<option value="">Day</option>' + Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join("");
  const now = new Date().getFullYear();
  yearSel.innerHTML = '<option value="">Year</option>' + Array.from({ length: 90 }, (_, i) => `<option value="${now - i}">${now - i}</option>`).join("");
  [monthSel, daySel, yearSel].forEach((s) => s.addEventListener("change", validateStep));
}

function dobComplete() {
  return $("#dobMonth").value && $("#dobDay").value && $("#dobYear").value;
}

function renderStep() {
  steps.forEach((s) => s.classList.toggle("active", +s.dataset.step === step));
  dots.forEach((d) => d.classList.toggle("active", +d.dataset.step <= step));
  $("#obBack").style.visibility = step === 0 ? "hidden" : "visible";
  $("#obContinue").textContent = step === LAST_STEP ? "Finish" : "Continue";
  validateStep();
}

function validateStep() {
  const btn = $("#obContinue");
  if (step === 0) btn.disabled = !dobComplete();
  else if (step === 1) btn.disabled = $("#obUsername").value.trim().length < 3;
  else if (step === LAST_STEP) btn.disabled = !$("#tosCheck").checked;
  else btn.disabled = false;
}

$("#obUsername").addEventListener("input", validateStep);
$("#tosCheck").addEventListener("change", validateStep);

document.querySelectorAll(".notif-opt").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll(".notif-opt").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    notifPref = b.dataset.notif;
  })
);

$("#obBack").addEventListener("click", () => {
  if (step > 0) step--;
  renderStep();
});

$("#obContinue").addEventListener("click", async () => {
  if (step < LAST_STEP) {
    step++;
    renderStep();
    return;
  }
  const dob = `${$("#dobYear").value}-${$("#dobMonth").value}-${$("#dobDay").value}`;
  config = await window.ogfn.saveConfig({
    username: $("#obUsername").value.trim(),
    tosAccepted: true,
    notifPref,
    dob,
  });
  showLauncher();
});

// ---- Launcher ----
function showLauncher() {
  $("#onboarding").classList.add("hidden");
  $("#launcher").classList.remove("hidden");
  refreshAnnouncement();
  window.ogfn.isGameRunning().then((running) => {
    gameRunning = !!running;
    refreshLaunchBar();
  });
}

function getSelectedSeasonMeta() {
  const id = config.selectedVersion;
  if (!id) return null;
  const version = (config.versions || []).find((v) => v.id === id);
  if (!version) return null;
  const season = (window.VELOCITY_SEASONS || []).find((s) => s.id === version.seasonId);
  return { version, season };
}

const ICON_DOWNLOAD = `
  <path d="M12 3v12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <path d="M8 11l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M4 19h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`;
const ICON_PLAY = `
  <path d="M8 5.5v13l11-6.5-11-6.5z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>`;

function refreshLaunchBar() {
  const meta = getSelectedSeasonMeta();
  const subEl = $("#launchSub");
  const textEl = $("#launchText");
  const iconEl = document.querySelector("#launchBtn .play-dl-icon");
  const btn = $("#launchBtn");

  if (launchPending) {
    textEl.textContent = "Starting…";
    btn.disabled = true;
    return;
  }

  if (gameRunning) {
    if (meta?.season) {
      subEl.textContent = `v${meta.season.build} - ${chapterLabel(meta.season.chapter)}`;
    }
    textEl.textContent = "Running";
    if (iconEl) iconEl.innerHTML = ICON_PLAY;
    btn.disabled = true;
    return;
  }

  btn.disabled = false;

  if (!meta?.season) {
    subEl.textContent = "Select a season in Library";
    textEl.textContent = "Download";
    if (iconEl) iconEl.innerHTML = ICON_DOWNLOAD;
    return;
  }

  const chLabel = chapterLabel(meta.season.chapter);
  subEl.textContent = `v${meta.season.build} - ${chLabel}`;
  textEl.textContent = meta.version.verified ? "Play" : "Download";
  if (iconEl) iconEl.innerHTML = meta.version.verified ? ICON_PLAY : ICON_DOWNLOAD;
}

async function refreshAnnouncement() {
  const a = await window.ogfn.getAnnouncement();
  $("#announceBody").textContent =
    a.text ||
    (a.online
      ? "Backend online. Ready to launch."
      : "Backend offline. Start Velocity or enable auto-start in settings.");
}

$("#launchBtn").addEventListener("click", async () => {
  const meta = getSelectedSeasonMeta();
  if (!meta?.version?.verified) {
    switchView("library");
    toast("Install and verify a season in Library first.");
    return;
  }

  launchPending = true;
  refreshLaunchBar();

  let r = await window.ogfn.launch();
  if (!r.ok && r.needsSetup) {
    toast("Setting up Fortnite connection… Watch for the Administrator prompt at the bottom of your screen.", "info");
    const setup = await window.ogfn.setupNet();
    if (setup.ok) {
      r = await window.ogfn.launch();
    } else {
      toast(setup.reason || "Setup cancelled.", "err");
      openSettings();
      refreshNetStatus();
    }
  }

  launchPending = false;

  if (r.ok) {
    gameRunning = await window.ogfn.isGameRunning();
    toast("Fortnite is launching!");
  } else if (!r.needsSetup) {
    toast(r.reason, "err");
    if (/executable|version/i.test(r.reason)) switchView("library");
  }

  refreshLaunchBar();
  refreshAnnouncement();
});

window.ogfn.onGameState((state) => {
  gameRunning = !!state.running;
  launchPending = false;
  refreshLaunchBar();
  refreshAnnouncement();
});

// ---- Settings ----
async function refreshServerUi() {
  const info = await window.ogfn.serverInfo();
  const mode = config.serverMode || "host";
  document.querySelector(`input[name="serverMode"][value="${mode}"]`)?.click();
  $("#setBackendHost").value = config.backendHost || "";
  $("#hostLanIp").textContent = info.lanIp;
  $("#hostShare").textContent = `${info.lanIp}:${info.httpPort}`;
  $("#hostInfo").classList.toggle("hidden", mode === "join");
  $("#joinBlock").classList.toggle("hidden", mode !== "join");
  $("#autoBackendRow").style.display = mode === "join" ? "none" : "flex";
}

async function refreshNetStatus() {
  const st = await window.ogfn.netStatus();
  const needsRepair = st.hostsBroken || st.hostsIpv6Broken;
  $("#netStatusText").textContent = st.ready ? "Ready" : needsRepair ? "Needs repair" : "Not set up";
  $("#netCertText").textContent = st.certTrusted ? "Trusted" : "Missing";
  $("#netHostsText").textContent = st.hostsIpv6Broken
    ? "IPv6 Epic redirects — run setup again"
    : st.hostsSet
      ? "Active"
      : st.hostsBroken
        ? "Broken — run setup again"
        : "Missing";
  $("#netProxyText").textContent = st.portproxyOk ? "Active" : "Missing";
  $("#netStatusCard").classList.toggle("needs-setup", !st.ready);
  $("#netSetupHint").classList.toggle("hidden", !!st.ready);
  $("#netSetupBtn").classList.toggle("pulse", !st.ready);
}

function openSettings() {
  $("#setUsername").value = config.username || "";
  $("#setGamePath").value = config.gamePath || "";
  $("#setExtraArgs").value = config.extraArgs || "";
  $("#setAutoBackend").checked = config.autoStartBackend !== false;
  $("#setDiscordPresence").checked = config.discordPresence !== false;
  $("#setDiscordClientId").value = config.discordClientId || "";
  refreshServerUi();
  refreshNetStatus().then(async () => {
    const st = await window.ogfn.netStatus();
    if (!st.ready) {
      toast("Game connection is required. Click Set up connection and approve Administrator.", "info");
    }
  });
  $("#settings").classList.remove("hidden");
}
function closeSettings() {
  $("#settings").classList.add("hidden");
}
document.querySelectorAll('input[name="serverMode"]').forEach((r) =>
  r.addEventListener("change", () => {
    const join = r.value === "join" && r.checked;
    $("#hostInfo").classList.toggle("hidden", join);
    $("#joinBlock").classList.toggle("hidden", !join);
    $("#autoBackendRow").style.display = join ? "none" : "flex";
  })
);

$("#copyShare").addEventListener("click", async () => {
  const text = $("#hostShare").textContent;
  if (!text || text === "—") return;
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied to clipboard!");
  } catch {
    toast("Could not copy", "err");
  }
});
$("#railSettings").addEventListener("click", openSettings);
$("#settingsClose").addEventListener("click", closeSettings);

$("#netSetupBtn").addEventListener("click", async () => {
  $("#netSetupBtn").disabled = true;
  const elevated = (await window.ogfn.netStatus()).elevated;
  toast(
    elevated
      ? "Running setup now (Velocity is already Administrator)…"
      : "Approve the Windows Administrator (UAC) prompt — choose Yes.",
    "info"
  );
  const r = await window.ogfn.setupNet();
  await refreshNetStatus();
  $("#netSetupBtn").disabled = false;
  if (r.ok) {
    toast("Connection ready! You can launch Fortnite now.");
  } else {
    toast(r.reason || "Setup failed.", "err");
    if (r.manualSetup) {
      toast("Check your Desktop for Velocity-Setup.bat", "info");
    }
  }
});

$("#netManualBtn").addEventListener("click", async () => {
  $("#netManualBtn").disabled = true;
  const r = await window.ogfn.manualSetupNet();
  $("#netManualBtn").disabled = false;
  if (r.ok) {
    toast(r.message || "Open Velocity-Setup.bat on your Desktop → Run as administrator.", "info");
  } else {
    toast(r.reason || "Could not create manual setup file.", "err");
  }
});

$("#netTeardownBtn").addEventListener("click", async () => {
  $("#netTeardownBtn").disabled = true;
  const r = await window.ogfn.teardownNet();
  await refreshNetStatus();
  $("#netTeardownBtn").disabled = false;
  toast(r.ok ? "Setup removed." : "Could not remove setup.", r.ok ? "ok" : "err");
});

// ---- Mods ----
function openMods() {
  const m = config.mods || {};
  $("#modEditOnRelease").checked = !!m.editOnRelease;
  $("#modInstantReset").checked = !!m.instantReset;
  $("#modSprintDefault").checked = !!m.sprintDefault;
  $("#modDisablePreEdit").checked = !!m.disablePreEdit;
  $("#mods").classList.remove("hidden");
}
$("#modsWrench").addEventListener("click", openMods);
$("#modsClose").addEventListener("click", () => $("#mods").classList.add("hidden"));
$("#modsSave").addEventListener("click", async () => {
  config = await window.ogfn.saveConfig({
    mods: {
      editOnRelease: $("#modEditOnRelease").checked,
      instantReset: $("#modInstantReset").checked,
      sprintDefault: $("#modSprintDefault").checked,
      disablePreEdit: $("#modDisablePreEdit").checked,
    },
  });
  $("#mods").classList.add("hidden");
  toast("Mods saved!");
});

$("#pickGame").addEventListener("click", async () => {
  const p = await window.ogfn.pickGame();
  if (p) $("#setGamePath").value = p;
});

$("#pickBackground").addEventListener("click", async () => {
  const file = await window.ogfn.pickBackground();
  if (file) {
    config.backgroundFile = file;
    applyBackground();
    toast("Background updated!");
  }
});

$("#resetBackground").addEventListener("click", async () => {
  await window.ogfn.resetBackground();
  config.backgroundFile = "";
  applyBackground();
  toast("Background reset to default.");
});

$("#settingsSave").addEventListener("click", async () => {
  const mode = document.querySelector('input[name="serverMode"]:checked')?.value || "host";
  config = await window.ogfn.saveConfig({
    username: $("#setUsername").value.trim() || "VelocityPlayer",
    gamePath: $("#setGamePath").value.trim(),
    extraArgs: $("#setExtraArgs").value.trim(),
    autoStartBackend: $("#setAutoBackend").checked,
    serverMode: mode,
    backendHost: $("#setBackendHost").value.trim() || "127.0.0.1:3551",
    discordPresence: $("#setDiscordPresence").checked,
    discordClientId: $("#setDiscordClientId").value.trim(),
  });
  closeSettings();
  toast("Settings saved!");
  refreshAnnouncement();
});

// ---- Rail navigation ----
const CHANGELOG = [
  { ver: "v1.0.0", title: "Initial release", items: ["Velocity backend + XMPP party system", "Nova-style launcher with onboarding", "Web control panel", "Cosmetic granting & V-Bucks"] },
  { ver: "v1.0.1", title: "Launcher polish", items: ["Custom background picker", "New Velocity app icon", "Working sidebar navigation (Library, Changelog, Cosmetics)"] },
  { ver: "v1.0.3", title: "Season library", items: ["Full catalog Ch1 S1 → Ch5 S4 (+ OG & Remix)", "One-click Install with auto folder setup", "Chapter filters for every era", "Verify & auto-select flow"] },
];

function switchView(view) {
  document.querySelectorAll(".rail-btn[data-view]").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === view)
  );
  document.querySelectorAll(".stage-view").forEach((v) =>
    v.classList.toggle("active", v.id === `view-${view}`)
  );
  document.querySelector(".stage")?.classList.toggle("panel-active", view !== "home");
  window.ogfn?.setDiscordView?.(view);
  if (view === "home") {
    refreshAnnouncement();
    refreshLaunchBar();
  }
  if (view === "library") loadLibrary();
  if (view === "cosmetics") loadCosmetics();
}

document.querySelectorAll(".rail-btn[data-view]").forEach((b) =>
  b.addEventListener("click", () => switchView(b.dataset.view))
);

// ---- Library (season catalog) ----
let libraryChapter = "all";
// seasonId -> latest progress payload while a download is running
const seasonDownloads = new Map();

function versionForSeason(seasonId) {
  return (config.versions || []).find((v) => v.seasonId === seasonId);
}

function fmtBytes(n) {
  if (!n) return "0 MB";
  const gb = n / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(n / (1024 * 1024))} MB`;
}

function chapterLabel(ch) {
  return `Chapter ${ch}`;
}

function seasonBadge(s) {
  if (s.chapter === 1 && s.season === 10) return "SX";
  if (s.chapter === 1 && s.season === 11) return "OG";
  if (s.id === "c2remix") return "Remix";
  return `C${s.chapter}S${s.season}`;
}

function seasonArt(s) {
  const artClass = s.chapter >= 2 ? "c2" : "c1";
  const artLabel = seasonBadge(s);
  if (s.icon) {
    return `<div class="season-art ${artClass} has-img"><img src="${s.icon}" alt="${artLabel}" loading="lazy" onerror="var p=this.parentElement;this.remove();p.classList.remove('has-img');p.textContent='${artLabel}'"></div>`;
  }
  return `<div class="season-art ${artClass}">${artLabel}</div>`;
}

let seasonIconsReady = false;
async function ensureSeasonIcons() {
  if (seasonIconsReady || !window.ogfn?.resolveAsset) return;
  const seasons = window.VELOCITY_SEASONS || [];
  await Promise.all(
    seasons.map(async (s) => {
      if (!s.icon || s.icon.startsWith("file:") || s.icon.startsWith("http")) return;
      const url = await window.ogfn.resolveAsset(s.icon);
      if (url) s.icon = url;
    })
  );
  seasonIconsReady = true;
}

function renderSeasonCard(s) {
  const v = versionForSeason(s.id);
  const selected = v && config.selectedVersion === v.id;
  const installed = !!v;
  const verified = v?.verified;
  const dl = seasonDownloads.get(s.id);

  // Downloading state takes over the whole card body.
  if (dl) {
    const pct = dl.pct || 0;
    let phaseText = "Starting…";
    if (dl.phase === "downloading") {
      const speed = dl.speedBps ? ` · ${fmtBytes(dl.speedBps)}/s` : "";
      phaseText = `${fmtBytes(dl.received)} / ${dl.total ? fmtBytes(dl.total) : "?"}${speed}`;
    } else if (dl.phase === "extracting") phaseText = "Extracting files…";
    else if (dl.phase === "verifying") phaseText = "Verifying…";

    const indeterminate = dl.phase !== "downloading";
    return `<article class="season-card downloading" data-season="${s.id}">
      <div class="season-top">
        ${seasonArt(s)}
        <div class="season-meta">
          <div class="season-chapter">${chapterLabel(s.chapter)}</div>
          <div class="season-name">${s.label}</div>
          <div class="season-build">v${s.build}</div>
        </div>
      </div>
      <div class="dl-progress ${indeterminate ? "indeterminate" : ""}">
        <div class="dl-bar" style="width:${indeterminate ? 100 : pct}%"></div>
      </div>
      <div class="season-status status-pending"><span class="status-dot"></span>${phaseText}${dl.phase === "downloading" ? ` · ${pct}%` : ""}</div>
      <div class="season-actions">
        <button class="season-btn ghost" data-cancel="${s.id}">Cancel</button>
      </div>
    </article>`;
  }

  let status = "Not installed";
  let statusClass = "status-none";
  if (installed && verified) {
    status = selected ? "Ready · selected" : "Installed · verified";
    statusClass = selected ? "status-selected" : "status-ready";
  } else if (installed) {
    status = "Needs verification";
    statusClass = "status-pending";
  }

  let actions = "";
  if (!installed) {
    const canDownload = window.VELOCITY_SEASON_DOWNLOADS?.has(s.id);
    const manual = s.manualUrls?.length;
    if (canDownload) {
      actions = `
      <button class="season-btn primary" data-install="${s.id}">Install${s.sizeGB ? ` · ~${s.sizeGB} GB` : ""}</button>
      <button class="season-btn" data-locate="${s.id}" title="Already have this build? Point Velocity at its folder.">Locate</button>`;
    } else if (manual) {
      actions = `
      <button class="season-btn primary" data-manual="${s.id}" title="Open download page in your browser (~${s.sizeGB || "?"} GB)">Get build</button>
      <button class="season-btn" data-locate="${s.id}" title="After downloading, extract the build and point Velocity at the folder.">Locate</button>`;
    } else {
      actions = `<button class="season-btn primary" data-locate="${s.id}">Locate build</button>`;
    }
  } else if (!verified) {
    actions = `
      <button class="season-btn primary" data-verify="${v.id}">Verify</button>
      <button class="season-btn" data-open="${v.id}">Open folder</button>
      <button class="season-btn ghost" data-remove="${v.id}">Remove</button>`;
  } else {
    actions = selected
      ? `<button class="season-btn primary" disabled>Selected</button><button class="season-btn" data-open="${v.id}">Open folder</button>`
      : `<button class="season-btn primary" data-select="${v.id}">Select</button><button class="season-btn" data-open="${v.id}">Open folder</button><button class="season-btn ghost" data-remove="${v.id}">Remove</button>`;
  }

  return `<article class="season-card ${installed ? "installed" : ""} ${selected ? "selected" : ""}" data-season="${s.id}">
    <div class="season-top">
      ${seasonArt(s)}
      <div class="season-meta">
        <div class="season-chapter">${chapterLabel(s.chapter)}</div>
        <div class="season-name">${s.label}</div>
        <div class="season-build">v${s.build}</div>
      </div>
    </div>
    <div class="season-status ${statusClass}"><span class="status-dot"></span>${status}</div>
    <div class="season-actions">${actions}</div>
  </article>`;
}

async function loadLibrary() {
  await ensureSeasonIcons();
  const seasons = window.VELOCITY_SEASONS || [];
  const filtered = seasons.filter((s) => libraryChapter === "all" || String(s.chapter) === libraryChapter);
  $("#seasonGrid").innerHTML = filtered.map(renderSeasonCard).join("");

  $("#seasonGrid").querySelectorAll("[data-manual]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const season = seasons.find((x) => x.id === btn.dataset.manual);
      if (!season?.manualUrls?.length) return;
      const pick = season.manualUrls[0];
      window.ogfn.openExternal(pick.url);
      const alt = season.manualUrls[1];
      toast(
        alt
          ? `Opened ${pick.label} — download v${season.build}, extract, then Locate. If that link fails, try ${alt.label}.`
          : `Opened ${pick.label} — download v${season.build}, extract, then Locate.`
      );
    })
  );

  $("#seasonGrid").querySelectorAll("[data-install]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const season = seasons.find((x) => x.id === btn.dataset.install);
      if (!season) return;
      seasonDownloads.set(season.id, { phase: "starting", pct: 0 });
      loadLibrary();
      toast(`Downloading ${season.label} — keep the launcher open.`);
      const r = await window.ogfn.downloadSeason(season);
      seasonDownloads.delete(season.id);
      config = await window.ogfn.getConfig();
      loadLibrary();
      refreshLaunchBar();
      if (r.ok) toast(`${season.label} installed and ready to play!`);
      else if (r.cancelled) toast("Download cancelled.");
      else toast(`${r.reason || "Download failed"} — try Locate if you already have the build.`, "err");
    })
  );

  $("#seasonGrid").querySelectorAll("[data-locate]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const season = seasons.find((x) => x.id === btn.dataset.locate);
      if (!season) return;
      const r = await window.ogfn.installSeason(season);
      config = await window.ogfn.getConfig();
      loadLibrary();
      refreshLaunchBar();
      if (r.cancelled) toast("Install folder opened — add your build, then click Verify.");
      else if (r.ok && r.verified) toast(`${season.label} linked and selected!`);
      else if (r.ok) toast("Folder linked — drop in your build files, then Verify.");
      else toast(r.reason || "Failed to link folder", "err");
    })
  );

  $("#seasonGrid").querySelectorAll("[data-cancel]").forEach((btn) =>
    btn.addEventListener("click", () => window.ogfn.cancelDownload(btn.dataset.cancel))
  );

  $("#seasonGrid").querySelectorAll("[data-verify]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const r = await window.ogfn.verifyVersion(btn.dataset.verify);
      config = await window.ogfn.getConfig();
      const v = (config.versions || []).find((x) => x.id === btn.dataset.verify);
      if (r.ok && v) await window.ogfn.selectVersion(v.id);
      config = await window.ogfn.getConfig();
      loadLibrary();
      refreshLaunchBar();
      toast(r.ok ? "Verified and selected!" : "FortniteClient-Win64-Shipping.exe not found.", r.ok ? "ok" : "err");
    })
  );

  $("#seasonGrid").querySelectorAll("[data-select]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      await window.ogfn.selectVersion(btn.dataset.select);
      config = await window.ogfn.getConfig();
      loadLibrary();
      refreshLaunchBar();
      toast("Season selected!");
    })
  );

  $("#seasonGrid").querySelectorAll("[data-open]").forEach((btn) =>
    btn.addEventListener("click", () => window.ogfn.openVersionFolder(btn.dataset.open))
  );

  $("#seasonGrid").querySelectorAll("[data-remove]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      await window.ogfn.removeVersion(btn.dataset.remove);
      config = await window.ogfn.getConfig();
      loadLibrary();
      refreshLaunchBar();
      toast("Removed from library.");
    })
  );
}

document.querySelectorAll(".chapter-tab").forEach((tab) =>
  tab.addEventListener("click", () => {
    document.querySelectorAll(".chapter-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    libraryChapter = tab.dataset.chapter;
    loadLibrary();
  })
);

// Live download progress from the main process. Update the card in place so
// the whole grid doesn't re-render (which would kill button focus).
window.ogfn.onSeasonProgress((data) => {
  if (["done", "error", "cancelled"].includes(data.phase)) {
    seasonDownloads.delete(data.seasonId);
    return;
  }
  seasonDownloads.set(data.seasonId, data);

  const card = document.querySelector(`.season-card[data-season="${data.seasonId}"]`);
  if (!card || !card.classList.contains("downloading")) {
    if ($("#view-library").classList.contains("active")) loadLibrary();
    return;
  }

  const bar = card.querySelector(".dl-bar");
  const wrap = card.querySelector(".dl-progress");
  const statusEl = card.querySelector(".season-status");
  const indeterminate = data.phase !== "downloading";
  if (wrap) wrap.classList.toggle("indeterminate", indeterminate);
  if (bar) bar.style.width = indeterminate ? "100%" : `${data.pct || 0}%`;
  if (statusEl) {
    let phaseText = "Starting…";
    if (data.phase === "downloading") {
      const speed = data.speedBps ? ` · ${fmtBytes(data.speedBps)}/s` : "";
      phaseText = `${fmtBytes(data.received)} / ${data.total ? fmtBytes(data.total) : "?"}${speed} · ${data.pct || 0}%`;
    } else if (data.phase === "extracting") phaseText = "Extracting files…";
    else if (data.phase === "verifying") phaseText = "Verifying…";
    statusEl.innerHTML = `<span class="status-dot"></span>${phaseText}`;
  }
});

// ---- Changelog view ----
function renderChangelog() {
  $("#changelogList").innerHTML = [...CHANGELOG]
    .reverse()
    .map(
      (r) =>
        `<article class="news-card">
          <div class="news-card-head">
            <h3>${r.title}</h3>
            <span class="news-ver">${r.ver}</span>
          </div>
          <ul>${r.items.map((i) => `<li>${i}</li>`).join("")}</ul>
        </article>`
    )
    .join("");
}

// ---- Cosmetics view (full catalog: C1 S1 → C2 S4) ----
let cosFilter = "all";
let cosSeasonFilter = "all";
let cosSearchQuery = "";
let cosCatalog = null;
let cosCatalogLoading = false;

function seasonLabel(ch, s) {
  if (ch === 1 && s === 10) return "Chapter 1 · Season X";
  if (ch === 1 && s === 11) return "Chapter 1 · OG";
  if (s === 9 && ch === 2) return "Chapter 2 · Remix";
  return `Chapter ${ch} · Season ${s}`;
}

function buildSeasonOptions(items) {
  const seen = new Set();
  const opts = ['<option value="all">All seasons (Ch1 → Ch5)</option>'];
  for (const c of items) {
    const key = `${c.chapter}-${c.season}`;
    if (seen.has(key)) continue;
    seen.add(key);
    opts.push(`<option value="${key}">${seasonLabel(c.chapter, c.season)}</option>`);
  }
  $("#cosSeason").innerHTML = opts.join("");
}

function filteredCosmetics() {
  if (!cosCatalog) return [];
  let items = cosCatalog;
  if (cosFilter !== "all") items = items.filter((c) => c.type === cosFilter);
  if (cosSeasonFilter !== "all") {
    const [ch, s] = cosSeasonFilter.split("-").map(Number);
    items = items.filter((c) => c.chapter === ch && c.season === s);
  }
  if (cosSearchQuery) {
    const q = cosSearchQuery.toLowerCase();
    items = items.filter((c) => c.name.toLowerCase().includes(q));
  }
  return items;
}

function renderCosCard(c) {
  return `<button class="cos-card" data-template="${c.templateId}" title="${c.name} · ${seasonLabel(c.chapter, c.season)}">
    <div class="cos-img-wrap">
      <img class="cos-img" src="${c.icon}" alt="${c.name}" loading="lazy"
        onerror="this.style.opacity='0.3'" />
    </div>
    <span class="cos-name">${c.name}</span>
    <span class="cos-rarity">${c.rarity}</span>
    <span class="cos-type">${c.type}</span>
  </button>`;
}

function renderCosGrid() {
  const items = filteredCosmetics();
  $("#cosCount").textContent = `${items.length.toLocaleString()} cosmetic${items.length === 1 ? "" : "s"}`;
  $("#cosGrid").innerHTML = items.length ? items.map(renderCosCard).join("") : `<p class="cos-loading">No cosmetics match your filters.</p>`;

  $("#cosGrid").querySelectorAll(".cos-card").forEach((card) =>
    card.addEventListener("click", async () => {
      if (card.classList.contains("granting")) return;
      card.classList.add("granting");
      const r = await window.ogfn.grantCosmetic(card.dataset.template);
      card.classList.remove("granting");
      if (r.ok) {
        card.classList.add("granted");
        toast(r.live ? "Granted — check your locker!" : "Granted (open locker to refresh)");
        setTimeout(() => card.classList.remove("granted"), 1200);
      } else toast(r.reason || "Failed — is the backend online?", "err");
    })
  );
}

async function ensureCosCatalog() {
  if (cosCatalog) return true;
  if (cosCatalogLoading) return false;
  cosCatalogLoading = true;
  $("#cosLoading").classList.remove("hidden");
  $("#cosGrid").innerHTML = "";

  const r = await window.ogfn.getCosmeticsCatalog();
  cosCatalogLoading = false;
  $("#cosLoading").classList.add("hidden");

  if (!r.ok) {
    $("#cosCount").textContent = r.reason || "Failed to load";
    return false;
  }
  cosCatalog = r.items;
  buildSeasonOptions(cosCatalog);
  return true;
}

async function loadCosmetics() {
  const id = await window.ogfn.resolveAccount();
  $("#cosAccount").textContent = id ? id.slice(0, 16) + "…" : "backend offline";

  if (!(await ensureCosCatalog())) return;
  renderCosGrid();
}

document.querySelectorAll(".cos-tab").forEach((tab) =>
  tab.addEventListener("click", () => {
    document.querySelectorAll(".cos-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    cosFilter = tab.dataset.type;
    renderCosGrid();
  })
);

$("#cosSeason").addEventListener("change", (e) => {
  cosSeasonFilter = e.target.value;
  renderCosGrid();
});

let cosSearchTimer;
$("#cosSearch").addEventListener("input", (e) => {
  clearTimeout(cosSearchTimer);
  cosSearchTimer = setTimeout(() => {
    cosSearchQuery = e.target.value.trim();
    renderCosGrid();
  }, 200);
});

$("#cosGrantAll").addEventListener("click", async () => {
  if (!(await ensureCosCatalog())) return;

  const count = cosCatalog.length;
  const label = count.toLocaleString();
  if (
    !confirm(
      `Grant all ${label} cosmetics in this catalog to your account?\n\nIf Fortnite is open, items should appear in your locker without restarting.`
    )
  ) {
    return;
  }

  const btn = $("#cosGrantAll");
  btn.disabled = true;
  btn.textContent = "Granting…";

  const r = await window.ogfn.grantAllCosmetics(cosCatalog.map((c) => c.templateId));
  btn.disabled = false;
  btn.textContent = "Grant all";

  if (!r.ok) {
    toast(r.reason || "Grant all failed — is the backend online?", "err");
    return;
  }

  if (!r.granted) {
    toast(r.reason || "You already own everything in this catalog.");
    return;
  }

  const msg = r.live
    ? `Granted ${r.granted.toLocaleString()} cosmetics — check your locker!`
    : `Granted ${r.granted.toLocaleString()} cosmetics (open locker to refresh)`;
  toast(msg);
  renderCosGrid();
});

// ---- Boot ----
(async function init() {
  config = await window.ogfn.getConfig();
  applyBackground();
  renderChangelog();
  initDob();
  if (config.tosAccepted && config.username) {
    showLauncher();
  } else {
    renderStep();
    refreshLaunchBar();
  }
  // Keep the announcement/status fresh.
  setInterval(() => {
    if (!$("#launcher").classList.contains("hidden")) refreshAnnouncement();
  }, 8000);
})();
