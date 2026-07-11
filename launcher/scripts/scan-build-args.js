const fs = require("fs");

function scanFile(file, patterns) {
  const fd = fs.openSync(file, "r");
  const chunkSize = 8 * 1024 * 1024;
  const overlap = 512;
  const buf = Buffer.alloc(chunkSize + overlap);
  let pos = 0;
  const size = fs.statSync(file).size;
  const found = new Map(patterns.map((p) => [p.name, new Set()]));

  while (pos < size) {
    const read = fs.readSync(fd, buf, 0, Math.min(buf.length, size - pos), pos);
    const slice = buf.subarray(0, read + overlap);
    const text = slice.toString("latin1");
    for (const p of patterns) {
      for (const m of text.matchAll(p.re)) {
        found.get(p.name).add(m[0]);
        if (found.get(p.name).size >= 3) break;
      }
    }
    pos += chunkSize;
  }
  fs.closeSync(fd);
  return found;
}

const win64 =
  process.argv[2] ||
  "C:\\Users\\jwalt\\Downloads\\++Fortnite+Release-31.41-CL-37324991-Windows\\FortniteGame\\Binaries\\Win64";

const patterns = [
  { name: "caldera", re: /-caldera=eyJ[A-Za-z0-9_\-.]+/g },
  { name: "jwt", re: /eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_\-.]+/g },
  { name: "fltoken", re: /-fltoken=[A-Za-z0-9]+/g },
  { name: "epicmsg", re: /Please launch the game through[^\x00]{0,80}/g },
];

for (const file of fs.readdirSync(win64)) {
  if (!file.endsWith(".exe")) continue;
  const p = `${win64}\\${file}`;
  const st = fs.statSync(p);
  if (st.size > 500 * 1024 * 1024) {
    console.log(file, "skip huge", st.size);
    continue;
  }
  const hits = scanFile(p, patterns);
  console.log("\n==", file, "==");
  for (const [name, set] of hits) {
    const arr = [...set];
    if (!arr.length) continue;
    console.log(name, arr.length);
    for (const v of arr.slice(0, 2)) console.log(" ", v.slice(0, 160));
  }
}
