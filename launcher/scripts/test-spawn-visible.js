const { spawn } = require("child_process");
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
    const child = spawn(cfg.gamePath, args, { cwd: win64, detached: false, stdio: "inherit", shell: false });
    child.on("error", (e) => console.error("spawn error", e));
    child.on("exit", (code, sig) => console.error("exit", code, sig));
    setTimeout(() => {}, 15000);
  });
});
