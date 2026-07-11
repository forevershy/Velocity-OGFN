const https = require("https");

function resolveBuzz(pageUrl) {
  return new Promise((resolve, reject) => {
    const base = pageUrl.replace(/\/?$/, "/");
    https.get(
      `${base}download`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Referer: base,
          "hx-current-url": base,
        },
      },
      (res) => {
        console.log("buzz resolve", res.statusCode, res.headers);
        const hx = res.headers["hx-redirect"] || res.headers["Hx-Redirect"];
        const loc = res.headers.location;
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          console.log("body", body.slice(0, 200));
          resolve({ hx, loc });
        });
      }
    ).on("error", reject);
  });
}

function downloadHead(url, depth = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && depth < 6) {
        console.log("redirect", url, "->", res.headers.location);
        res.resume();
        return resolve(downloadHead(new URL(res.headers.location, url).href, depth + 1));
      }
      let n = 0;
      res.on("data", (c) => {
        n += c.length;
        if (n > 500000) res.destroy();
      });
      res.on("close", () =>
        resolve({ status: res.statusCode, cl: res.headers["content-length"], got: n })
      );
      res.on("end", () =>
        resolve({ status: res.statusCode, cl: res.headers["content-length"], got: n })
      );
    }).on("error", reject);
  });
}

(async () => {
  const buzz = await resolveBuzz("https://buzzheavier.com/25mkyjh092el");
  console.log("resolved", buzz);
  if (buzz.loc) {
    const h = await downloadHead(buzz.loc);
    console.log("direct", h);
  }
})();
