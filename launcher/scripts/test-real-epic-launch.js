const { spawn, exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");
const { createHash } = require("crypto");
const { getProcessPid } = require("../spawn-with-parent");

const cfg = require("C:/Users/jwalt/AppData/Roaming/velocity-app/velocity-launcher.json");
const win64 = path.dirname(cfg.gamePath);
const cache = path.join(require("os").tmpdir(), "velocity-real-epic-test");

const EPIC_PATHS = [
  "C:/Program Files (x86)/Epic Games/Launcher/Portal/Binaries/Win32/EpicGamesLauncher.exe",
  "C:/Program Files/Epic Games/Launcher/Portal/Binaries/Win32/EpicGamesLauncher.exe",
];

function accountIdFromName(name) {
  return createHash("md5").update(String(name).toLowerCase()).digest("hex");
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

function findEpic() {
  return EPIC_PATHS.find((p) => fs.existsSync(p));
}

async function ensureEpic() {
  const epic = findEpic();
  if (!epic) throw new Error("Real Epic not found");
  let pid = await getProcessPid("EpicGamesLauncher.exe");
  if (pid) return { epic, pid };
  spawn(epic, ["-silent"], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    pid = await getProcessPid("EpicGamesLauncher.exe");
    if (pid) return { epic, pid };
  }
  throw new Error("Epic did not start");
}

async function test(label, fn) {
  console.log(`\n=== ${label} ===`);
  await run("taskkill /F /IM FortniteClient-Win64-Shipping.exe /T 2>nul");
  await run("taskkill /F /IM FortniteLauncher.exe /T 2>nul");
  await new Promise((r) => setTimeout(r, 1500));
  await fn();
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const ship = await running("FortniteClient-Win64-Shipping.exe");
    const fl = await running("FortniteLauncher.exe");
    const epic = await running("EpicGamesLauncher.exe");
    console.log(`  t${i + 1}s shipping=${ship} fl=${fl} epic=${epic}`);
    if (ship) {
      console.log(label, "SUCCESS");
      return true;
    }
  }
  console.log(label, "FAIL");
  return false;
}

(async () => {
  const code = await fetchCode();
  const baseArgs = [
    "-AUTH_TYPE=exchangecode",
    `-AUTH_PASSWORD=${code}`,
    "-epicapp=Fortnite",
    "-epicenv=Prod",
    "-epiclocale=en-US",
    "-epicusername=shy",
    `-epicuserid=${accountIdFromName("shy")}`,
    "-skippatchcheck",
    "-nobe",
    "-epicportal",
  ];

  await test("real epic + idle fl + shipping", async () => {
    const { epic } = await ensureEpic();
    console.log("  epic at", epic);
    spawn(path.join(win64, "FortniteLauncher.exe"), [], {
      cwd: win64,
      detached: true,
      stdio: "ignore",
    }).unref();
    await new Promise((r) => setTimeout(r, 2000));
    spawn(cfg.gamePath, baseArgs, { cwd: win64, detached: true, stdio: "ignore" }).unref();
  });

  await test("real epic + fl -launch + shipping args", async () => {
    await ensureEpic();
    const code2 = await fetchCode();
    const args = [...baseArgs];
    args[1] = `-AUTH_PASSWORD=${code2}`;
    spawn(path.join(win64, "FortniteLauncher.exe"), ["-launch", "-App=Fortnite", ...args], {
      cwd: win64,
      detached: true,
      stdio: "ignore",
    }).unref();
  });

  await test("real epic -launch app=Fne", async () => {
    const { epic } = await ensureEpic();
    spawn(epic, ["-launch", "-app=Fne", "-silent"], { detached: true, stdio: "ignore" }).unref();
  });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
