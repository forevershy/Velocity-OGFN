const { exec } = require("child_process");

const EAC_EOS_EXE = "FortniteClient-Win64-Shipping_EAC_EOS.exe";

function processMatchText(imageName) {
  const base = String(imageName).replace(/\.exe$/i, "").toLowerCase();
  return { base, short: base.slice(0, 25) };
}

function isProcessRunning(imageName) {
  const { base, short } = processMatchText(imageName);
  return new Promise((resolve) => {
    exec("tasklist /NH", { windowsHide: true }, (err, stdout) => {
      const text = (stdout || "").toLowerCase();
      resolve(!err && (text.includes(base) || text.includes(short)));
    });
  });
}

function isFortniteGameRunning() {
  return isProcessRunning("FortniteClient-Win64-Shipping.exe");
}

module.exports = { isProcessRunning, isFortniteGameRunning, EAC_EOS_EXE };
