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
      res.on("end", () => resolve({ status: res.statusCode, json: JSON.parse(d) }));
    });
    r.on("error", reject);
    if (body) r.write(body);
    r.end();
  });
}

(async () => {
  const acc = await req("POST", "https://api.gofile.io/accounts");
  const token = acc.json.data.token;
  for (const id of ["MfJHqg", "pIYSae", "cw0eee"]) {
    const c = await req("GET", `https://api.gofile.io/contents/${id}?token=${token}`);
    console.log(id, c.json.status);
    const d = c.json.data;
    if (!d) continue;
    if (d.type === "folder" && d.children) {
      const kids = Object.values(d.children);
      console.log("  folder kids", kids.map((k) => ({ name: k.name, link: k.link, size: k.size })));
    } else {
      console.log("  file", d.name, d.link, d.size);
    }
  }
})();
