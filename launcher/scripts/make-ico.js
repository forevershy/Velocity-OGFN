const fs = require("fs");
const pngToIco = require("png-to-ico").default || require("png-to-ico");

pngToIco("build/icon.png")
  .then((buf) => {
    fs.writeFileSync("build/icon.ico", buf);
    console.log("Wrote build/icon.ico", buf.length, "bytes");
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
