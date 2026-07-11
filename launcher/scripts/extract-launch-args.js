const fs = require("fs");

const exe =
  process.argv[2] ||
  "C:\\Users\\jwalt\\Downloads\\++Fortnite+Release-31.41-CL-37324991-Windows\\FortniteGame\\Binaries\\Win64\\FortniteClient-Win64-Shipping.exe";

if (!fs.existsSync(exe)) {
  console.error("missing", exe);
  process.exit(1);
}

const buf = fs.readFileSync(exe);
const text = buf.toString("latin1");

const calderaArgs = [...text.matchAll(/-caldera=eyJ[A-Za-z0-9_\-.]+/g)].map((m) => m[0]);
const jwts = [...text.matchAll(/eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_\-.]+/g)].map((m) => m[0]);
const fltokens = [...text.matchAll(/-fltoken=[A-Za-z0-9]+/g)].map((m) => m[0]);
const fromfl = [...text.matchAll(/-fromfl=[a-z]+/gi)].map((m) => m[0]);

console.log("caldera args", calderaArgs.length, calderaArgs[0]?.slice(0, 120));
console.log("jwts", jwts.length, jwts[0]?.slice(0, 120));
console.log("fltokens", [...new Set(fltokens)].slice(0, 5));
console.log("fromfl", [...new Set(fromfl)].slice(0, 5));

if (jwts[0]) console.log("\nFULL_CALDERA", jwts[0]);
