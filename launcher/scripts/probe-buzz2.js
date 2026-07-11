const https = require("https");

function get(url) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
          },
        },
        (res) => {
          let d = "";
          res.on("data", (c) => (d += c));
          res.on("end", () => resolve({ status: res.statusCode, ct: res.headers["content-type"], body: d.slice(0, 3000) }));
        }
      )
      .on("error", reject);
  });
}

(async () => {
  for (const u of [
    "https://buzzheavier.com/25mkyjh092el",
    "https://buzzheavier.com/25mkyjh092el/download",
    "https://buzzheavier.com/api/download/25mkyjh092el",
  ]) {
    try {
      const r = await get(u);
      console.log("---", u, r.status, r.ct);
      console.log(r.body.replace(/\s+/g, " ").slice(0, 500));
    } catch (e) {
      console.log(u, e.message);
    }
  }
})();
