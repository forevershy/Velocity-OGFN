const https = require("https");

function req(method, url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      method,
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: { "User-Agent": "Mozilla/5.0 Velocity/1.0" },
    };
    if (body) {
      opts.headers["Content-Type"] = "application/json";
      opts.headers["Content-Length"] = Buffer.byteLength(body);
    }
    const r = https.request(opts, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, json: JSON.parse(d), raw: d });
        } catch {
          resolve({ status: res.statusCode, json: null, raw: d.slice(0, 500) });
        }
      });
    });
    r.on("error", reject);
    if (body) r.write(body);
    r.end();
  });
}

(async () => {
  for (const m of ["GET", "POST"]) {
    const r = await req(m, "https://api.gofile.io/accounts");
    console.log("accounts", m, r.status, r.raw?.slice(0, 200));
  }
})();
