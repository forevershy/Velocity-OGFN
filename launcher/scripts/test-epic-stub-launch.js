const { spawn, exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");
const os = require("os");

const cfg = require("C:/Users/jwalt/AppData/Roaming/velocity-app/velocity-launcher.json");
const win64 = path.dirname(cfg.gamePath);
const cache = path.join(os.tmpdir(), "velocity-launch-test");

function run(cmd) {
  return new Promise((resolve) => exec(cmd, { windowsHide: true }, () => resolve()));
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

function makeStub(out) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const safe = out.replace(/'/g, "''");
  const script = `Add-Type -TypeDefinition 'using System;using System.Threading;public class S{public static void Main(){Thread.Sleep(Timeout.Infinite);}}' -OutputAssembly '${safe}' -OutputType ConsoleApplication`;
  return new Promise((resolve, reject) => {
    spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
      stdio: "ignore",
    }).on("close", (code) => (code === 0 ? resolve() : reject(new Error("stub build failed"))));
  });
}

async function test(label, fn) {
  console.log(`\n=== ${label} ===`);
  await run("taskkill /F /IM FortniteClient-Win64-Shipping.exe /T 2>nul");
  await run("taskkill /F /IM FortniteLauncher.exe /T 2>nul");
  await run("taskkill /F /IM EpicGamesLauncher.exe /T 2>nul");
  await new Promise((r) => setTimeout(r, 1500));
  await fn();
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await running("FortniteClient-Win64-Shipping.exe")) {
      console.log(label, "shipping RUNNING at", i + 1, "s");
      await run("taskkill /F /IM FortniteClient-Win64-Shipping.exe /T 2>nul");
      return true;
    }
  }
  console.log(label, "shipping NOT detected");
  return false;
}

(async () => {
  const code = await fetchCode();
  const args = [
    "-AUTH_TYPE=exchangecode",
    `-AUTH_PASSWORD=${code}`,
    "-epicapp=Fortnite",
    "-epicenv=Prod",
    "-skippatchcheck",
    "-nobe",
    "-fromfl=be",
    "-HTTP=WinInet",
    "-epicportal",
  ];
  const epicStub = path.join(cache, "EpicGamesLauncher.exe");
  if (!fs.existsSync(epicStub)) await makeStub(epicStub);

  await test("direct only", async () => {
    spawn(cfg.gamePath, args, { cwd: win64, detached: true, stdio: "ignore" }).unref();
  });

  await test("epic stub + fl + shipping", async () => {
    spawn(epicStub, [], { detached: true, stdio: "ignore" }).unref();
    spawn(path.join(win64, "FortniteLauncher.exe"), [], { cwd: win64, detached: true, stdio: "ignore" }).unref();
    await new Promise((r) => setTimeout(r, 2000));
    spawn(cfg.gamePath, args, { cwd: win64, detached: true, stdio: "ignore" }).unref();
  });

  await test("fl mediated", async () => {
    const code2 = await fetchCode();
    args[1] = `-AUTH_PASSWORD=${code2}`;
    spawn(path.join(win64, "FortniteLauncher.exe"), ["-launch", "-App=Fortnite", ...args], {
      cwd: win64,
      detached: true,
      stdio: "ignore",
    }).unref();
  });

  await run("taskkill /F /IM FortniteLauncher.exe /T 2>nul");
  await run("taskkill /F /IM EpicGamesLauncher.exe /T 2>nul");
})().catch(console.error);
