const https = require("https");

function get(url, depth = 0) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && depth < 6) {
          res.resume();
          return resolve(get(new URL(res.headers.location, url).href, depth + 1));
        }
        let received = 0;
        res.on("data", (chunk) => {
          received += chunk.length;
          if (received > 2 * 1024 * 1024) {
            res.destroy();
            resolve({ url, status: res.statusCode, cl: res.headers["content-length"], received, ok: true });
          }
        });
        res.on("end", () => resolve({ url, status: res.statusCode, cl: res.headers["content-length"], received, ok: received > 1000000 }));
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

(async () => {
  const urls = [
    "https://drive.usercontent.google.com/download?id=1iXO_8PE4EnOv1hzs8V6pUtqZ9hE5jRKb&export=download&confirm=t",
    "https://cdn.fortnitearchive.com/31.41.rar",
    "https://cdn.fortnitearchive.com/31.41.zip",
    "https://galaxiafn.co.uk/31.41.rar",
  ];
  for (const u of urls) {
    try {
      const r = await get(u);
      console.log(JSON.stringify(r));
    } catch (e) {
      console.log(u, e.message);
    }
  }
})();
