const https = require("https");

function get(url, depth = 0) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "Mozilla/5.0 Velocity/1.0" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && depth < 5) {
          res.resume();
          return resolve(get(new URL(res.headers.location, url).href, depth + 1));
        }
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => resolve({ status: res.statusCode, ct: res.headers["content-type"], body: d.slice(0, 4000) }));
      })
      .on("error", reject);
  });
}

(async () => {
  const r = await get("https://buzzheavier.com/5deub93f6csc");
  console.log("status", r.status, r.ct);
  const links = [...r.body.matchAll(/https?:\/\/[^"'\s<>]+/g)].map((m) => m[0]);
  console.log("links", [...new Set(links)].filter((l) => /download|file|cdn|buzz/i.test(l)).slice(0, 10));
  console.log("snippet", r.body.slice(0, 800));
})();
