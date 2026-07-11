const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const fs = require("fs");
const { spawnWithParent, waitForProcessPid } = require("../spawn-with-parent");

const cache = path.join(os.tmpdir(), "velocity-spawn-test");

async function makeStub(out) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const safe = out.replace(/'/g, "''");
  const script = `Add-Type -TypeDefinition 'using System;using System.Threading;public class S{public static void Main(){Thread.Sleep(Timeout.Infinite);}}' -OutputAssembly '${safe}' -OutputType ConsoleApplication`;
  await new Promise((res, rej) => {
    spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], { stdio: "ignore" }).on(
      "close",
      (c) => (c === 0 ? res() : rej(new Error("stub fail")))
    );
  });
}

(async () => {
  const epicSrc = path.join(cache, "epic-stub.exe");
  const epicRun = path.join(cache, "EpicGamesLauncher.exe");
  await makeStub(epicSrc);
  fs.copyFileSync(epicSrc, epicRun);
  const epic = spawn(epicRun, [], { detached: true, stdio: "ignore", windowsHide: true });
  const epicPid = await new Promise((resolve, reject) => {
    epic.on("error", reject);
    epic.on("spawn", () => {
      epic.unref();
      resolve(epic.pid || 0);
    });
  });
  console.log("epicPid", epicPid);

  const win64 =
    "C:/Users/jwalt/Downloads/++Fortnite+Release-31.41-CL-37324991-Windows/FortniteGame/Binaries/Win64";
  const launcher = path.join(win64, "FortniteLauncher.exe");
  const childPid = await spawnWithParent(cache, epicPid, launcher, win64, []);
  console.log("launcherPid", childPid);

  require("child_process").exec("taskkill /F /IM FortniteLauncher.exe /T");
  require("child_process").exec("taskkill /F /IM EpicGamesLauncher.exe /T");
})().catch((e) => {
  console.error("FAIL", e.message);
  process.exit(1);
});
