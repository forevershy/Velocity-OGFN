const { spawn, exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");

const win64 =
  "C:/Users/jwalt/Downloads/++Fortnite+Release-31.41-CL-37324991-Windows/FortniteGame/Binaries/Win64";
const OFF = ".velocity-off";

function disablePath(target) {
  if (!fs.existsSync(target)) return null;
  const off = target + OFF;
  if (fs.existsSync(off)) return { target, off, disabled: false };
  fs.renameSync(target, off);
  return { target, off, disabled: true };
}

function restore(entries) {
  for (const e of entries) {
    if (e.disabled && fs.existsSync(e.off)) fs.renameSync(e.off, e.target);
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

async function testWithEacBlock() {
  const root = path.dirname(path.dirname(path.dirname(win64)));
  const entries = [];
  for (const t of [
    path.join(win64, "FortniteClient-Win64-Shipping_EAC.exe"),
    path.join(win64, "FortniteClient-Win64-Shipping_EAC_EOS.exe"),
    path.join(root, "EasyAntiCheat"),
  ]) {
    const e = disablePath(t);
    if (e) entries.push(e);
  }

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
  const exe = path.join(win64, "FortniteClient-Win64-Shipping.exe");
  spawn(exe, args, { cwd: win64, detached: true, stdio: "ignore" }).unref();
  await new Promise((r) => setTimeout(r, 8000));
  const running = await isRunning();
  console.log("with EAC block:", running ? "RUNNING" : "NOT RUNNING");
  exec("taskkill /F /IM FortniteClient-Win64-Shipping.exe /T 2>nul", () => restore(entries));
}

testWithEacBlock().catch(console.error);
