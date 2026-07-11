// Windows-side setup for the WinInet redirect method.
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const { spawn, exec } = require("child_process");

const HOSTS_PATH = path.join(process.env.windir || "C:\\Windows", "System32", "drivers", "etc", "hosts");
const BLOCK_START = "# === Velocity Fortnite redirect (managed) START ===";
const BLOCK_END = "# === Velocity Fortnite redirect (managed) END ===";
const CA_SUBJECT_MATCH = "Velocity Local CA";
const RESULT_PATH = path.join(os.tmpdir(), "velocity-setup-result.txt");

function run(cmd, args = [], opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { windowsHide: true, shell: false, ...opts });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => (stdout += d));
    child.stderr?.on("data", (d) => (stderr += d));
    child.on("error", (err) => resolve({ ok: false, stdout, stderr, code: -1, error: err.message }));
    child.on("close", (code) => resolve({ ok: code === 0, stdout: stdout.trim(), stderr: stderr.trim(), code }));
  });
}

function ps(scriptBody) {
  const encoded = Buffer.from(scriptBody, "utf16le").toString("base64");
  return run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded]);
}

function epicHostList(backendDir) {
  return require(path.join(backendDir, "structs", "epicHosts.js"));
}

function buildHostsBlock(targetIp, backendDir) {
  const lines = [];
  for (const h of epicHostList(backendDir)) {
    lines.push(`${targetIp} ${h}`);
    // Do NOT map Epic hosts to ::1 — portproxy only forwards IPv4 127.0.0.1:443.
    // IPv6 ::1:443 has no listener and breaks login on many Chapter 2 builds.
  }
  return [BLOCK_START, ...lines, BLOCK_END].join("\r\n");
}

function isProcessElevated() {
  return new Promise((resolve) => {
    exec("net session", { windowsHide: true }, (err) => resolve(!err));
  });
}

async function getCaTrustState(certDir) {
  const caPath = certDir ? path.join(certDir, "velocity-ca.crt") : null;
  if (!caPath || !fs.existsSync(caPath)) {
    return { certTrusted: false, certStale: false, userCaOk: false, machineCaOk: false };
  }

  const thumbCheck = await ps(
    `$file = '${caPath.replace(/'/g, "''")}'
$disk = (New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 $file).Thumbprint
$user = Get-ChildItem Cert:\\CurrentUser\\Root -ErrorAction SilentlyContinue |
  Where-Object { $_.Subject -like '*${CA_SUBJECT_MATCH}*' } |
  Select-Object -ExpandProperty Thumbprint -First 1
$machine = Get-ChildItem Cert:\\LocalMachine\\Root -ErrorAction SilentlyContinue |
  Where-Object { $_.Subject -like '*${CA_SUBJECT_MATCH}*' } |
  Select-Object -ExpandProperty Thumbprint -First 1
$userOk = ($user -eq $disk)
$machineOk = ($machine -eq $disk)
if ($userOk -or $machineOk) { 'OK' }
elseif ($user -or $machine) { 'STALE' }
else { 'MISSING' }`
  );

  const userCaOk = thumbCheck.stdout.includes("OK") && !thumbCheck.stdout.includes("STALE");
  const machineCaOk = userCaOk; // script only returns OK when either matches disk
  const certTrusted = thumbCheck.stdout.includes("OK");
  const certStale = thumbCheck.stdout.includes("STALE") || thumbCheck.stdout.includes("MISSING");
  return { certTrusted, certStale, userCaOk: certTrusted, machineCaOk: certTrusted };
}

async function installUserCaCert(caCertPath) {
  const result = await ps(
    `$caPath = '${caCertPath.replace(/'/g, "''")}'
if (-not (Test-Path -LiteralPath $caPath)) { 'ERR:missing' ; exit 1 }
Get-ChildItem Cert:\\CurrentUser\\Root -ErrorAction SilentlyContinue |
  Where-Object { $_.Subject -like '*${CA_SUBJECT_MATCH}*' } |
  Remove-Item -Force -ErrorAction SilentlyContinue
$store = New-Object System.Security.Cryptography.X509Certificates.X509Store('Root', 'CurrentUser')
$store.Open('ReadWrite')
$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($caPath)
$store.Add($cert)
$store.Close()
'OK'`
  );
  return result.stdout.includes("OK");
}

async function ensureUserCaTrusted(certDir) {
  const caPath = path.join(certDir, "velocity-ca.crt");
  if (!fs.existsSync(caPath)) {
    return { ok: false, reason: "Certificate file missing. Restart Velocity." };
  }
  const state = await getCaTrustState(certDir);
  if (state.certTrusted) return { ok: true };
  const installed = await installUserCaCert(caPath);
  if (!installed) {
    return { ok: false, reason: "Could not install the Velocity security certificate for your user account." };
  }
  return { ok: true };
}

async function status({ joinMode = false, certDir = process.env.VELOCITY_CERT_DIR } = {}) {
  let hostsSet = false;
  let hostsBroken = false;
  let hostsIpv6Broken = false;
  try {
    const content = fs.readFileSync(HOSTS_PATH, "utf8");
    hostsSet = content.includes(BLOCK_START);
    hostsBroken = content.length < 20 || !content.toLowerCase().includes("localhost");
    // Old setups mapped Epic hosts to ::1 — portproxy only listens on 127.0.0.1 (IPv4).
    hostsIpv6Broken = /^\s*::1\s+\S*epicgames\.com/im.test(content);
  } catch {
    hostsBroken = true;
  }

  const caState = await getCaTrustState(certDir);
  const certTrusted = caState.certTrusted;
  const certStale = caState.certStale;

  const proxyCheck = await run("netsh", ["interface", "portproxy", "show", "all"]);
  const proxyText = proxyCheck.stdout || "";
  const portproxyOk =
    proxyText.includes("443") &&
    proxyText.includes("8443") &&
    proxyText.includes("8080") &&
    (joinMode || proxyText.includes("0.0.0.0") || proxyText.includes("127.0.0.1"));

  let hostsStale = false;
  try {
    const content = fs.readFileSync(HOSTS_PATH, "utf8");
    // Older setups redirected Caldera to localhost; v23+ needs real Epic ES256 tokens.
    hostsStale =
      hostsSet &&
      content.includes("caldera-service-prod.ecosec.on.epicgames.com");
  } catch {
    hostsStale = true;
  }

  const ready = joinMode
    ? certTrusted && hostsSet && !hostsBroken && !hostsStale && !certStale && !hostsIpv6Broken
    : certTrusted &&
      hostsSet &&
      !hostsBroken &&
      !hostsStale &&
      !certStale &&
      !hostsIpv6Broken &&
      portproxyOk;

  return {
    certTrusted,
    certStale,
    hostsSet,
    hostsBroken,
    hostsIpv6Broken,
    hostsStale,
    portproxyOk,
    ready,
    elevated: await isProcessElevated(),
  };
}

function writeSetupScript({ caCert, block, resultPath, hostLines, hostMode = true }) {
  const scriptPath = path.join(os.tmpdir(), "velocity-netsetup.ps1");
  const psHostLines = hostLines.map((l) => `  '${l.replace(/'/g, "''")}'`).join(",\n");

  const script = `# Velocity one-time network setup
$Host.UI.RawUI.WindowTitle = 'Velocity Setup'
Write-Host ''
Write-Host '  Velocity - Setting up Fortnite connection...' -ForegroundColor Cyan
Write-Host '  Keep this window open until it says Done.' -ForegroundColor DarkGray
Write-Host ''
$ResultFile = '${resultPath.replace(/'/g, "''")}'
function Done($msg) { Set-Content -LiteralPath $ResultFile -Value $msg -Encoding UTF8 -Force }

try {
  $caPath = '${caCert.replace(/'/g, "''")}'
  if (-not (Test-Path -LiteralPath $caPath)) { Done 'ERR:Certificate file missing.'; exit 1 }

  Get-ChildItem Cert:\\CurrentUser\\Root -ErrorAction SilentlyContinue |
    Where-Object { $_.Subject -like '*${CA_SUBJECT_MATCH}*' } |
    Remove-Item -Force -ErrorAction SilentlyContinue
  Get-ChildItem Cert:\\LocalMachine\\Root -ErrorAction SilentlyContinue |
    Where-Object { $_.Subject -like '*${CA_SUBJECT_MATCH}*' } |
    Remove-Item -Force -ErrorAction SilentlyContinue

  $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($caPath)
  $userStore = New-Object System.Security.Cryptography.X509Certificates.X509Store('Root', 'CurrentUser')
  $userStore.Open('ReadWrite')
  $userStore.Add($cert)
  $userStore.Close()
  $machineStore = New-Object System.Security.Cryptography.X509Certificates.X509Store('Root', 'LocalMachine')
  $machineStore.Open('ReadWrite')
  $machineStore.Add($cert)
  $machineStore.Close()

  $hostsPath = '${HOSTS_PATH.replace(/'/g, "''")}'
  if (Test-Path -LiteralPath $hostsPath) {
    $item = Get-Item -LiteralPath $hostsPath -Force
    if ($item.IsReadOnly) { $item.IsReadOnly = $false }
  }

  $raw = ''
  if (Test-Path -LiteralPath $hostsPath) {
    $raw = Get-Content -LiteralPath $hostsPath -Raw -ErrorAction SilentlyContinue
  }
  if ($null -eq $raw) { $raw = '' }

  if ([string]::IsNullOrWhiteSpace($raw)) {
    $raw = @(
      '# Copyright (c) 1993-2009 Microsoft Corp.'
      '#'
      '127.0.0.1       localhost'
      '::1             localhost'
    ) -join [Environment]::NewLine
  }

  $pattern = '(?ms)#\\s*===\\s*Velocity Fortnite redirect \\(managed\\) START ===.*?(#\\s*===\\s*Velocity Fortnite redirect \\(managed\\) END ===\\r?\\n?)'
  $raw = [regex]::Replace($raw, $pattern, '')

  # Strip broken IPv6 Epic redirects from older Velocity builds.
  $clean = New-Object System.Collections.Generic.List[string]
  foreach ($line in ($raw -split "\\r?\\n")) {
    if ($line -match '^\\s*::1\\s+\\S*epicgames\\.com') { continue }
    $clean.Add($line)
  }
  $raw = ($clean -join [Environment]::NewLine)

  $velocityLines = @(
${psHostLines}
  )
  $block = @(
    '${BLOCK_START}'
    $velocityLines
    '${BLOCK_END}'
  ) -join [Environment]::NewLine

  $out = ($raw.TrimEnd() + [Environment]::NewLine + [Environment]::NewLine + $block + [Environment]::NewLine)
  Set-Content -LiteralPath $hostsPath -Value $out -Encoding ASCII -Force

  if (-not (Select-String -LiteralPath $hostsPath -Pattern 'Velocity Fortnite redirect' -Quiet)) {
    Done 'ERR:Hosts file was not updated.'
    exit 1
  }

  if (${hostMode ? "$true" : "$false"}) {
    $iphlp = Get-Service iphlpsvc -ErrorAction SilentlyContinue
    if ($iphlp -and $iphlp.Status -ne 'Running') {
      Start-Service iphlpsvc -ErrorAction SilentlyContinue
      Start-Sleep -Seconds 1
    }
    cmd /c "netsh interface portproxy delete v4tov4 listenport=443 listenaddress=127.0.0.1" 2>$null | Out-Null
    cmd /c "netsh interface portproxy delete v4tov4 listenport=80 listenaddress=127.0.0.1" 2>$null | Out-Null
    $p443 = cmd /c "netsh interface portproxy add v4tov4 listenport=443 listenaddress=127.0.0.1 connectport=8443 connectaddress=127.0.0.1" 2>&1
    if ($LASTEXITCODE -ne 0) { Done ('ERR:Port 443 forward failed: ' + ($p443 -join ' ')); exit 1 }
    $p80 = cmd /c "netsh interface portproxy add v4tov4 listenport=80 listenaddress=127.0.0.1 connectport=8080 connectaddress=127.0.0.1" 2>&1
    if ($LASTEXITCODE -ne 0) { Done ('ERR:Port 80 forward failed: ' + ($p80 -join ' ')); exit 1 }
  }

  Done 'OK'
  Write-Host '  Done! You can close this window and return to Velocity.' -ForegroundColor Green
  Start-Sleep -Seconds 3
  exit 0
} catch {
  Done ('ERR:' + $_.Exception.Message)
  Write-Host ('  Failed: ' + $_.Exception.Message) -ForegroundColor Red
  Start-Sleep -Seconds 8
  exit 1
}
`;
  fs.writeFileSync(scriptPath, script, "utf8");
  return scriptPath;
}

function getDesktopDir() {
  const candidates = [
    process.env.OneDrive && path.join(process.env.OneDrive, "Desktop"),
    path.join(os.homedir(), "OneDrive", "Desktop"),
    path.join(os.homedir(), "Desktop"),
    process.env.USERPROFILE && path.join(process.env.USERPROFILE, "Desktop"),
    os.tmpdir(),
  ].filter(Boolean);
  for (const dir of candidates) {
    try {
      if (fs.existsSync(dir)) return dir;
    } catch {
      /* try next */
    }
  }
  return os.tmpdir();
}

function writeManualSetupBat(scriptPath) {
  const desktop = getDesktopDir();
  fs.mkdirSync(desktop, { recursive: true });
  const batPath = path.join(desktop, "Velocity-Setup.bat");
  const bat = [
    "@echo off",
    "title Velocity Setup",
    "echo.",
    "echo  Velocity - Fortnite connection setup",
    "echo  If Windows asks, choose YES for Administrator access.",
    "echo.",
    `powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Normal -File "${scriptPath}"`,
    "echo.",
    `if exist "${RESULT_PATH}" type "${RESULT_PATH}"`,
    "echo.",
    "pause",
  ].join("\r\n");
  fs.writeFileSync(batPath, bat, "utf8");
  return batPath;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function fetchHostCa(hostIp) {
  return new Promise((resolve) => {
    const req = http.get(`http://${hostIp}:3551/ogfn-panel/api/ca`, (res) => {
      if (res.statusCode !== 200) return resolve(null);
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });
    req.on("error", () => resolve(null));
    req.setTimeout(5000, () => {
      req.destroy();
      resolve(null);
    });
  });
}

function runScriptDirect(scriptPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Normal", "-File", scriptPath],
      { windowsHide: false, shell: false, stdio: "ignore" }
    );
    child.on("error", reject);
    child.on("close", (code) => resolve(code));
  });
}

function launchElevatedVbs(scriptPath) {
  const vbsPath = path.join(os.tmpdir(), "velocity-elevate.vbs");
  const psArgs = `-NoProfile -ExecutionPolicy Bypass -WindowStyle Normal -File "${scriptPath.replace(/"/g, '""')}"`;
  const vbs = `CreateObject("Shell.Application").ShellExecute "powershell.exe", "${psArgs.replace(/"/g, '""')}", "", "runas", 1\r\n`;
  fs.writeFileSync(vbsPath, vbs, "utf8");

  return new Promise((resolve, reject) => {
    const child = spawn("wscript.exe", ["//Nologo", vbsPath], { windowsHide: false, shell: false });
    child.on("error", reject);
    child.on("close", (code) => resolve(code));
  });
}

function launchElevatedPowerShell(scriptPath) {
  const safeScript = scriptPath.replace(/'/g, "''");
  const inner = `Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Normal','-File','${safeScript}' -Verb RunAs`;
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", inner],
      { windowsHide: false, shell: false }
    );
    child.on("error", reject);
    child.on("close", (code) => resolve(code));
  });
}

async function waitForResult(resultPath, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if (fs.existsSync(resultPath)) {
        const text = fs.readFileSync(resultPath, "utf8").trim();
        if (text) return text;
      }
    } catch {
      /* still writing */
    }
    await sleep(400);
  }
  return null;
}

async function runElevatedScript(scriptPath, resultPath) {
  try {
    fs.rmSync(resultPath, { force: true });
  } catch {
    /* none yet */
  }

  const elevated = await isProcessElevated();

  if (elevated) {
    try {
      await runScriptDirect(scriptPath);
    } catch (err) {
      return { ok: false, reason: `Could not run setup: ${err.message}` };
    }
  } else {
    let launched = false;
    for (const launch of [launchElevatedVbs, launchElevatedPowerShell]) {
      try {
        await launch(scriptPath);
        launched = true;
        break;
      } catch {
        /* try next */
      }
    }
    if (!launched) {
      return { ok: false, reason: "Could not start the Administrator setup window.", needsManual: true };
    }
  }

  const result = await waitForResult(resultPath);

  if (result === "OK") return { ok: true };
  if (result?.startsWith("ERR:")) return { ok: false, reason: result.slice(4), needsManual: false };
  if (result) return { ok: false, reason: result, needsManual: false };

  return {
    ok: false,
    reason: elevated
      ? "Setup window closed before finishing. Watch for errors in the blue Velocity Setup window."
      : "No Administrator prompt appeared or setup was cancelled.",
    needsManual: true,
  };
}

async function prepareSetupFiles({ certDir, backendDir, targetIp, hostMode = true }) {
  let caCert = path.join(certDir, "velocity-ca.crt");

  if (!hostMode) {
    const remoteCa = await fetchHostCa(targetIp);
    if (!remoteCa) {
      return {
        ok: false,
        reason: `Could not reach the host at ${targetIp}:3551. Make sure your friend is hosting and their backend is running.`,
      };
    }
    caCert = path.join(os.tmpdir(), `velocity-host-ca-${targetIp}.crt`);
    fs.writeFileSync(caCert, remoteCa);
  } else if (!fs.existsSync(caCert)) {
    return { ok: false, reason: "Certificate not generated yet. Restart Velocity and try again." };
  }

  const hostLines = [];
  for (const h of epicHostList(backendDir)) {
    hostLines.push(`${targetIp} ${h}`);
  }
  const scriptPath = writeSetupScript({
    caCert,
    block: buildHostsBlock(targetIp, backendDir),
    resultPath: RESULT_PATH,
    hostLines,
    hostMode,
  });
  const batPath = writeManualSetupBat(scriptPath);
  return { ok: true, scriptPath, batPath, resultPath: RESULT_PATH };
}

async function applySetup(opts) {
  const prepared = await prepareSetupFiles(opts);
  if (!prepared.ok) return prepared;

  const res = await runElevatedScript(prepared.scriptPath, prepared.resultPath);

  if (!res.ok) {
    return {
      ...res,
      manualSetup: prepared.batPath,
      reason:
        (res.reason || "Setup failed.") +
        " Use the Velocity-Setup.bat file on your Desktop — right-click it → Run as administrator.",
    };
  }

  const st = await status({ joinMode: !opts.hostMode });
  return st.ready
    ? { ok: true }
    : {
        ok: false,
        reason: "Setup reported success but verification failed. Restart Velocity and try again.",
        manualSetup: prepared.batPath,
      };
}

async function openManualSetup(opts) {
  const prepared = await prepareSetupFiles(opts);
  if (!prepared.ok) return prepared;

  return {
    ok: true,
    batPath: prepared.batPath,
    scriptPath: prepared.scriptPath,
    message: "Velocity-Setup.bat was saved to your Desktop. Right-click it and choose Run as administrator.",
  };
}

async function removeSetup() {
  const resultPath = path.join(os.tmpdir(), "velocity-teardown-result.txt");
  const scriptPath = path.join(os.tmpdir(), `velocity-netteardown-${Date.now()}.ps1`);
  const script = `
$ResultFile = '${resultPath.replace(/'/g, "''")}'
try {
  $hostsPath = '${HOSTS_PATH.replace(/'/g, "''")}'
  if (Test-Path -LiteralPath $hostsPath) {
    $raw = Get-Content -LiteralPath $hostsPath -Raw -ErrorAction SilentlyContinue
    if ($null -eq $raw) { $raw = '' }
    $pattern = '(?ms)#\\s*===\\s*Velocity Fortnite redirect \\(managed\\) START ===.*?(#\\s*===\\s*Velocity Fortnite redirect \\(managed\\) END ===\\r?\\n?)'
    $raw = [regex]::Replace($raw, $pattern, '')
    Set-Content -LiteralPath $hostsPath -Value ($raw.TrimEnd() + [Environment]::NewLine) -Encoding ASCII -Force
  }
  Get-ChildItem Cert:\\LocalMachine\\Root -ErrorAction SilentlyContinue |
    Where-Object { $_.Subject -like '*${CA_SUBJECT_MATCH}*' } |
    Remove-Item -Force -ErrorAction SilentlyContinue
  foreach ($addr in @('127.0.0.1', '0.0.0.0')) {
    cmd /c "netsh interface portproxy delete v4tov4 listenport=443 listenaddress=$addr" 2>$null | Out-Null
    cmd /c "netsh interface portproxy delete v4tov4 listenport=80 listenaddress=$addr" 2>$null | Out-Null
  }
  Set-Content -LiteralPath $ResultFile -Value 'OK' -Encoding UTF8 -Force
  exit 0
} catch {
  Set-Content -LiteralPath $ResultFile -Value ('ERR:' + $_.Exception.Message) -Encoding UTF8 -Force
  exit 1
}
`;
  fs.writeFileSync(scriptPath, script, "utf8");
  const res = await runElevatedScript(scriptPath, resultPath);
  try {
    fs.rmSync(scriptPath);
  } catch {
    /* temp */
  }
  return { ok: res.ok, reason: res.reason };
}

module.exports = {
  status,
  applySetup,
  openManualSetup,
  removeSetup,
  ensureUserCaTrusted,
  installUserCaCert,
  HOSTS_PATH,
  isProcessElevated,
  getDesktopDir,
};
