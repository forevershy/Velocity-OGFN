const https = require("https");
const http = require("http");

function fetch(url, depth = 0) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    lib.get(url, { headers: { "User-Agent": "Mozilla/5.0 Velocity/1.0" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && depth < 6) {
        res.resume();
        return resolve(fetch(new URL(res.headers.location, url).href, depth + 1));
      }
      const chunks = [];
      res.on("data", (c) => {
        if (chunks.reduce((n, b) => n + b.length, 0) < 64) chunks.push(c);
      });
      res.on("end", () =>
        resolve({
          status: res.statusCode,
          ct: res.headers["content-type"],
          cl: res.headers["content-length"],
          buf: Buffer.concat(chunks).slice(0, 64),
        })
      );
    }).on("error", reject);
  });
}

(async () => {
  const urls = [
    "https://public.simplyblk.xyz/23.10.rar",
    "https://public.simplyblk.xyz/23.00.7z",
    "https://r2.ploosh.dev/24.20.zip",
    "https://r2.ploosh.dev/25.11.zip",
    "https://r2.ploosh.dev/26.30.zip",
    "https://gofile.io/d/MfJHqg",
    "https://buzzheavier.com/5deub93f6csc",
  ];
  for (const u of urls) {
    try {
      const r = await fetch(u);
      console.log(u, "->", r.status, r.ct, r.cl, r.buf.toString("hex").slice(0, 32), JSON.stringify(r.buf.toString("utf8").slice(0, 40)));
    } catch (e) {
      console.log(u, "ERR", e.message);
    }
  }
})();
