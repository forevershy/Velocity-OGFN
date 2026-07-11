const { spawn, exec } = require("child_process");
const path = require("path");
const http = require("http");
const { spawnWithParent, getProcessPid } = require("../spawn-with-parent");

const cfg = require("C:/Users/jwalt/AppData/Roaming/velocity-app/velocity-launcher.json");
const win64 = path.dirname(cfg.gamePath);
const cache = path.join(require("os").tmpdir(), "velocity-ppid-test");
const epicPath =
  "C:/Program Files (x86)/Epic Games/Launcher/Portal/Binaries/Win32/EpicGamesLauncher.exe";

function fetchCode() {
  return new Promise((resolve, reject) => {
    http
      .get("http://127.0.0.1:3551/account/api/oauth/exchange?username=shy", (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => resolve(JSON.parse(d).code));
      })
      .on("error", reject);
  });
}

function run(cmd) {
  return new Promise((r) => exec(cmd, { windowsHide: true }, () => r()));
}

function running(name) {
  return new Promise((resolve) => {
    exec(`tasklist /FI "IMAGENAME eq ${name}" /NH`, { windowsHide: true }, (err, out) => {
      resolve(!err && out.toLowerCase().includes(name.toLowerCase()));
    });
  });
}

(async () => {
  await run("taskkill /F /IM FortniteClient-Win64-Shipping.exe /T 2>nul");
  await run("taskkill /F /IM FortniteLauncher.exe /T 2>nul");
  await new Promise((r) => setTimeout(r, 1500));

  const code = await fetchCode();
  const args = [
    "-AUTH_TYPE=exchangecode",
    `-AUTH_PASSWORD=${code}`,
    "-epicapp=Fortnite",
    "-epicenv=Prod",
    "-skippatchcheck",
    "-nobe",
    "-epicportal",
  ];

  let epicPid = await getProcessPid("EpicGamesLauncher.exe");
  if (!epicPid) {
    spawn(epicPath, ["-silent"], { detached: true, stdio: "ignore" }).unref();
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      epicPid = await getProcessPid("EpicGamesLauncher.exe");
      if (epicPid) break;
    }
  }
  console.log("epicPid", epicPid);

  const launcher = path.join(win64, "FortniteLauncher.exe");
  const launchArgs = ["-launch", "-App=Fortnite", ...args];
  const flPid = await spawnWithParent(cache, epicPid, launcher, win64, launchArgs);
  console.log("flPid", flPid);

  await new Promise((r) => setTimeout(r, 8000));
  console.log("fl running", await running("FortniteLauncher.exe"));
  console.log("shipping running", await running("FortniteClient-Win64-Shipping.exe"));

  if (!(await running("FortniteClient-Win64-Shipping.exe"))) {
    const shipPid = await spawnWithParent(cache, flPid, cfg.gamePath, win64, args);
    console.log("shipPid fallback", shipPid);
    await new Promise((r) => setTimeout(r, 10000));
    console.log("shipping after fallback", await running("FortniteClient-Win64-Shipping.exe"));
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
