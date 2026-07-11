const https = require("https");
const fs = require("fs");

https
  .get("https://gofile.io/d/5KnfUv", { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
    let d = "";
    res.on("data", (c) => (d += c));
    res.on("end", () => {
      const patterns = [
        /https:\/\/store[^"'\s\\]+/g,
        /directLink":"([^"]+)"/g,
        /"link":"([^"]+)"/g,
        /download\/web\/[^"'\s]+/g,
      ];
      for (const p of patterns) {
        const m = [...d.matchAll(p)].map((x) => x[1] || x[0]);
        if (m.length) console.log(p, [...new Set(m)].slice(0, 5));
      }
      console.log("len", d.length);
    });
  });
