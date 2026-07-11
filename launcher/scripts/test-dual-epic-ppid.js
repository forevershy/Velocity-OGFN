const { spawn, exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawnWithParent, getProcessPid } = require("../spawn-with-parent");

const cfg = require("C:/Users/jwalt/AppData/Roaming/velocity-app/velocity-launcher.json");
const win64 = path.dirname(cfg.gamePath);
const cache = path.join(require("os").tmpdir(), "velocity-dual-epic-test");
const realEpic =
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

function makeStub(out) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const safe = out.replace(/'/g, "''");
  const script = `Add-Type -TypeDefinition 'using System;using System.Threading;public class S{public static void Main(){Thread.Sleep(Timeout.Infinite);}}' -OutputAssembly '${safe}' -OutputType ConsoleApplication`;
  return new Promise((resolve, reject) => {
    spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
      stdio: "ignore",
    }).on("close", (code) => (code === 0 ? resolve() : reject(new Error("stub fail"))));
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

  // Real Epic running (path validation)
  let realEpicPid = await getProcessPid("EpicGamesLauncher.exe");
  if (!realEpicPid) {
    spawn(realEpic, ["-silent"], { detached: true, stdio: "ignore" }).unref();
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      realEpicPid = await getProcessPid("EpicGamesLauncher.exe");
      if (realEpicPid) break;
    }
  }
  console.log("realEpicPid", realEpicPid);

  // Stub Epic for PPID (OpenProcess works on our stub)
  const stubPath = path.join(cache, "EpicGamesLauncher.exe");
  if (!fs.existsSync(stubPath)) await makeStub(stubPath);
  const epicChild = spawn(stubPath, [], { detached: true, stdio: "ignore" });
  await new Promise((r) => epicChild.on("spawn", r));
  epicChild.unref();
  const stubEpicPid = epicChild.pid;
  console.log("stubEpicPid", stubEpicPid);

  const launcher = path.join(win64, "FortniteLauncher.exe");
  const flPid = await spawnWithParent(cache, stubEpicPid, launcher, win64, [
    "-launch",
    "-App=Fortnite",
    ...args,
  ]);
  console.log("flPid", flPid);
  await new Promise((r) => setTimeout(r, 5000));

  if (!(await running("FortniteClient-Win64-Shipping.exe"))) {
    const shipPid = await spawnWithParent(cache, flPid, cfg.gamePath, win64, args);
    console.log("shipPid", shipPid);
  }

  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    console.log(
      `t${(i + 1) * 2}s shipping=${await running("FortniteClient-Win64-Shipping.exe")} fl=${await running("FortniteLauncher.exe")} epic=${await running("EpicGamesLauncher.exe")}`
    );
    if (await running("FortniteClient-Win64-Shipping.exe")) break;
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
