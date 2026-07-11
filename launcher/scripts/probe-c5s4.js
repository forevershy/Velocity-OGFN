const https = require("https");

function probe(url, depth = 0) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : require("http");
    const req = lib.get(url, { headers: { "User-Agent": "Mozilla/5.0 Velocity/1.0" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && depth < 5) {
        res.resume();
        return resolve(probe(new URL(res.headers.location, url).href, depth + 1));
      }
      let received = 0;
      let last = Date.now();
      const timer = setInterval(() => {
        if (Date.now() - last > 15000) {
          clearInterval(timer);
          req.destroy();
          resolve({ url, status: res.statusCode, cl: res.headers["content-length"], received, stalled: true });
        }
      }, 1000);
      res.on("data", (chunk) => {
        received += chunk.length;
        last = Date.now();
        if (received >= 1024 * 1024) {
          clearInterval(timer);
          req.destroy();
          resolve({ url, status: res.statusCode, cl: res.headers["content-length"], received, stalled: false });
        }
      });
      res.on("end", () => {
        clearInterval(timer);
        resolve({ url, status: res.statusCode, cl: res.headers["content-length"], received, stalled: false });
      });
      res.on("error", (e) => {
        clearInterval(timer);
        reject(e);
      });
    });
    req.on("error", reject);
    req.setTimeout(20000, () => {
      req.destroy();
      reject(new Error("timeout"));
    });
  });
}

(async () => {
  const urls = [
    "https://fn-builds.repressoh.it/30.40-CL-35235494.zip",
    "https://cold-na-phx-6.gofile.io/download/web/32cce581-05c7-4f1f-aad3-a21ab207b418/%2B%2BFortnite%2BRelease-31.41-CL-37324991-Windows.rar",
    "https://r2.ploosh.dev/31.41.zip",
    "https://public.simplyblk.xyz/31.41.rar",
  ];
  for (const u of urls) {
    try {
      const r = await probe(u);
      console.log(JSON.stringify(r));
    } catch (e) {
      console.log(u, "ERR", e.message);
    }
  }
})();
