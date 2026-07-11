const https = require("https");

https
  .get("https://gofile.io/d/5KnfUv", { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
    let d = "";
    res.on("data", (c) => (d += c));
    res.on("end", () => {
      for (const pat of [/websiteToken['":\s]+([A-Za-z0-9]+)/g, /wt=([A-Za-z0-9]+)/g, /"id":"([^"]+)"/g]) {
        console.log(String(pat), [...d.matchAll(pat)].slice(0, 3).map((m) => m[1]));
      }
    });
  });
