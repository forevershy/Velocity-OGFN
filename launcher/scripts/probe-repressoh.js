const https = require("https");

function head(url, depth = 0) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "Mozilla/5.0 Velocity/1.0" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && depth < 4) {
          res.resume();
          return resolve(head(new URL(res.headers.location, url).href, depth + 1));
        }
        const chunks = [];
        res.on("data", (c) => {
          if (chunks.reduce((n, b) => n + b.length, 0) < 8) chunks.push(c);
        });
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            cl: res.headers["content-length"],
            buf: Buffer.concat(chunks).slice(0, 8),
          })
        );
      })
      .on("error", reject);
  });
}

(async () => {
  const urls = [
    "https://fn-builds.repressoh.it/23.10-CL-23443094.rar",
    "https://fn-builds.repressoh.it/24.20-CL-25156858.zip",
    "https://fn-builds.repressoh.it/25.11.zip",
    "https://fn-builds.repressoh.it/26.30-CL-28688692.zip",
  ];
  for (const u of urls) {
    try {
      const r = await head(u);
      console.log(u, "->", r.status, r.cl, r.buf.toString("hex"), r.buf.toString("ascii", 0, 4));
    } catch (e) {
      console.log(u, "ERR", e.message);
    }
  }
})();
