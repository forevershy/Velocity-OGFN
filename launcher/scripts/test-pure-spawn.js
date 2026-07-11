const { spawn, exec } = require("child_process");
const http = require("http");
const path = require("path");

const cfg = require("C:/Users/jwalt/AppData/Roaming/velocity-app/velocity-launcher.json");
const win64 = path.dirname(cfg.gamePath);

http.get("http://127.0.0.1:3551/account/api/oauth/exchange?username=shy", (res) => {
  let d = "";
  res.on("data", (c) => (d += c));
  res.on("end", () => {
    const code = JSON.parse(d).code;
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
    setTimeout(() => {
      exec('tasklist /FI "IMAGENAME eq FortniteClient-Win64-Shipping.exe" /NH', { windowsHide: true }, (e, o) => {
        console.log(o.trim() || "none");
        exec("taskkill /F /IM FortniteClient-Win64-Shipping.exe /T");
      });
    }, 8000);
  });
});
