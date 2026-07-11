/**
 * Download season card icons from fortnite-api.com (512px outfit icons).
 * Run: node scripts/fetch-season-icons.js
 */
const fs = require("fs");
const path = require("path");
const https = require("https");

const outDir = path.join(__dirname, "..", "renderer", "season-icons");

// Tier-1 / iconic outfit per season (search names on fortnite-api.com).
const NEW_ICONS = {
  c1og: "Renegade Raider",
  c2s5: "Mancake",
  c2s6: "Spire Assassin",
  c2s7: "Kymera",
  c2s8: "Haven",
  c2remix: "Snoop Dogg",
  c3s1: "Shanta",
  c3s2: "Evie",
  c3s3: "Stormfarer",
  c3s4: "Helsie",
  c4s1: "Era",
  c4s2: "Mizuki",
  c4s3: "Antonia",
  c4s4: "Relik",
  c5s1: "Oscar",
  c5s2: "Aphrodite",
  c5s3: "Hope",
  c5s4: "Peelverine",
};

function getJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "Velocity/1.0" } }, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", reject);
  });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "Velocity/1.0" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return resolve(download(res.headers.location, dest));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          fs.writeFileSync(dest, Buffer.concat(chunks));
          resolve();
        });
      })
      .on("error", reject);
  });
}

async function findCosmetic(name) {
  const q = encodeURIComponent(name);
  const json = await getJson(`https://fortnite-api.com/v2/cosmetics/br/search/all?name=${q}`);
  const items = json.data || [];
  const exact = items.find((c) => c.name?.toLowerCase() === name.toLowerCase());
  const outfit = exact || items.find((c) => c.type?.value === "outfit") || items[0];
  return outfit || null;
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });

  // Copy existing icons from asar extract if local source is missing.
  const extractDir = path.join(__dirname, "..", "_icon-extract", "renderer", "season-icons");
  if (fs.existsSync(extractDir)) {
    for (const file of fs.readdirSync(extractDir)) {
      const dest = path.join(outDir, file);
      if (!fs.existsSync(dest)) fs.copyFileSync(path.join(extractDir, file), dest);
    }
  }

  const catalog = await getJson("https://fortnite-api.com/v2/cosmetics/br");
  const byName = new Map((catalog.data || []).map((c) => [c.name.toLowerCase(), c]));

  for (const [id, name] of Object.entries(NEW_ICONS)) {
    const dest = path.join(outDir, `${id}.png`);
    if (fs.existsSync(dest)) {
      console.log(`skip ${id} (exists)`);
      continue;
    }

    let cosmetic = byName.get(name.toLowerCase());
    if (!cosmetic) cosmetic = await findCosmetic(name);
    if (!cosmetic?.images?.icon) {
      console.warn(`FAIL ${id}: no icon for "${name}"`);
      continue;
    }

    await download(cosmetic.images.icon, dest);
    console.log(`ok ${id} <- ${cosmetic.name}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
