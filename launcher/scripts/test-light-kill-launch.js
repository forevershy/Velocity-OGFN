const { spawn, exec } = require("child_process");
const http = require("http");
const path = require("path");

const cfg = require("C:/Users/jwalt/AppData/Roaming/velocity-app/velocity-launcher.json");
const win64 = path.dirname(cfg.gamePath);

function runCmd(cmd) {
  return new Promise((resolve) => exec(cmd, { windowsHide: true }, () => resolve()));
}

async function killLight() {
  for (const cmd of [
    "taskkill /F /IM EpicGamesLauncher.exe /T",
    "taskkill /F /IM FortniteClient-Win64-Shipping.exe /T",
  ]) {
    await runCmd(`${cmd} 2>nul`);
  }
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

(async () => {
  await killLight();
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
  spawn(cfg.gamePath, args, { cwd: win64, detached: true, stdio: "ignore" }).unref();
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await isRunning()) {
      console.log("RUNNING after", i + 1, "s");
      exec("taskkill /F /IM FortniteClient-Win64-Shipping.exe /T");
      return;
    }
  }
  console.log("NOT RUNNING after 20s");
})();
