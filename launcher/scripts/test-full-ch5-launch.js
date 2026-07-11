const path = require("path");
const http = require("http");
const { createHash } = require("crypto");
const { exec } = require("child_process");
const cfg = require("C:/Users/jwalt/AppData/Roaming/velocity-app/velocity-launcher.json");
const { launchFortnite } = require("../launch-game");
const { getDirectLaunchExtras, resolveBuildNumber } = require("../launch-profiles");

function accountIdFromName(name) {
  return createHash("md5").update(String(name).toLowerCase()).digest("hex");
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

function shippingRunning() {
  return new Promise((resolve) => {
    exec('tasklist /FI "IMAGENAME eq FortniteClient-Win64-Shipping.exe" /NH', { windowsHide: true }, (err, out) => {
      resolve(!err && out.toLowerCase().includes("fortniteclient-win64-shipping.exe"));
    });
  });
}

(async () => {
  const code = await fetchCode();
  const build = resolveBuildNumber(cfg, cfg.gamePath);
  const args = [
    "-AUTH_TYPE=exchangecode",
    `-AUTH_PASSWORD=${code}`,
    "-epicapp=Fortnite",
    "-epicenv=Prod",
    "-epiclocale=en-US",
    "-epicusername=shy",
    `-epicuserid=${accountIdFromName("shy")}`,
    "-skippatchcheck",
    ...getDirectLaunchExtras(build),
    "-epicportal",
  ];
  console.log("launch extras", getDirectLaunchExtras(build));
  await launchFortnite(cfg.gamePath, args, {
    stubCacheDir: path.join(require("os").tmpdir(), "velocity-launch-cache"),
    cfg,
    waitUntilRunning: false,
  });
  console.log("launch dispatched");
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const running = await shippingRunning();
    console.log("t", (i + 1) * 2, "shipping", running);
    if (running) break;
  }
})().catch((e) => {
  console.error("FAIL", e.message);
  process.exit(1);
});
