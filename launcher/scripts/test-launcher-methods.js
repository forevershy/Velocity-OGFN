const { spawn, exec } = require("child_process");
const http = require("http");
const path = require("path");

const cfg = require("C:/Users/jwalt/AppData/Roaming/velocity-app/velocity-launcher.json");
const win64 = path.dirname(cfg.gamePath);
const { createHash } = require("crypto");

function accountIdFromName(name) {
  return createHash("md5").update(String(name).toLowerCase()).digest("hex");
}

function fetchCode() {
  return new Promise((resolve, reject) => {
    http.get("http://127.0.0.1:3551/account/api/oauth/exchange?username=shy", (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => resolve(JSON.parse(d).code));
    }).on("error", reject);
  });
}

function isRunning() {
  return new Promise((resolve) => {
    exec('tasklist /FI "IMAGENAME eq FortniteClient-Win64-Shipping.exe" /NH', { windowsHide: true }, (err, out) => {
      resolve(!err && out.toLowerCase().includes("fortniteclient-win64-shipping.exe"));
    });
  });
}

function cleanup() {
  exec("taskkill /F /IM FortniteClient-Win64-Shipping.exe /T 2>nul");
  exec("taskkill /F /IM FortniteLauncher.exe /T 2>nul");
}

async function waitRunning(label, ms = 15000) {
  for (let i = 0; i < ms / 1000; i++) {
    if (await isRunning()) {
      console.log(label, "RUNNING after", i + 1, "s");
      return true;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log(label, "NOT RUNNING");
  return false;
}

async function main() {
  cleanup();
  await new Promise((r) => setTimeout(r, 2000));

  const code = await fetchCode();
  const args = [
    "-AUTH_TYPE=exchangecode",
    `-AUTH_PASSWORD=${code}`,
    "-epicapp=Fortnite",
    "-epicenv=Prod",
    "-epiclocale=en-US",
    "-epicusername=shy",
    `-epicuserid=${accountIdFromName("shy")}`,
    "-skippatchcheck",
    "-nobe",
    "-fromfl=be",
    "-HTTP=WinInet",
    "-epicportal",
  ];

  const launcherExe = path.join(win64, "FortniteLauncher.exe");
  const shippingExe = cfg.gamePath;

  // Test 1: mediated launch
  console.log("\n--- Test 1: FortniteLauncher -launch -App=Fortnite ---");
  spawn(launcherExe, ["-launch", "-App=Fortnite", ...args], {
    cwd: win64,
    detached: true,
    stdio: "ignore",
  }).unref();
  if (await waitRunning("mediated")) {
    cleanup();
    await new Promise((r) => setTimeout(r, 2000));
    return;
  }
  cleanup();
  await new Promise((r) => setTimeout(r, 2000));

  // Test 2: dual process
  console.log("\n--- Test 2: dual FortniteLauncher + shipping ---");
  const code2 = await fetchCode();
  args[1] = `-AUTH_PASSWORD=${code2}`;
  spawn(launcherExe, [], { cwd: win64, detached: true, stdio: "ignore" }).unref();
  await new Promise((r) => setTimeout(r, 1500));
  spawn(shippingExe, args, { cwd: win64, detached: true, stdio: "ignore" }).unref();
  await waitRunning("dual");
  cleanup();
}

main().catch(console.error);
