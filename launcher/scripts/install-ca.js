const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");

const scriptPath = path.join(os.tmpdir(), "velocity-install-ca.ps1");
const resultPath = path.join(os.tmpdir(), "velocity-ca-install-result.txt");

try {
  fs.rmSync(resultPath, { force: true });
} catch {
  /* none */
}

const ps = spawn(
  "powershell.exe",
  [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    `Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File "${scriptPath.replace(/\\/g, "\\\\")}"'`,
  ],
  { stdio: "inherit", windowsHide: false }
);

ps.on("close", () => {
  setTimeout(() => {
    if (fs.existsSync(resultPath)) {
      console.log(fs.readFileSync(resultPath, "utf8").trim());
    } else {
      console.log("No result — UAC may have been cancelled.");
    }
  }, 500);
});
