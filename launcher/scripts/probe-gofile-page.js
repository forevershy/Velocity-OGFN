const https = require("https");

function get(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "Mozilla/5.0 Velocity/1.0" } }, (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => resolve({ status: res.statusCode, body: d }));
      })
      .on("error", reject);
  });
}

(async () => {
  const r = await get("https://gofile.io/d/MfJHqg");
  const links = [...r.body.matchAll(/https:\/\/store[^"'\s]+/g)].map((m) => m[0]);
  console.log("status", r.status, "len", r.body.length, "store links", [...new Set(links)].slice(0, 5));
  const scripts = r.body.match(/window\.__NUXT__|children|directLink|downloadPage/gi);
  console.log("keywords", scripts?.slice(0, 10));
})();
