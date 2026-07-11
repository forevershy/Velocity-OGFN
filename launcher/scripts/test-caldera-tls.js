const tls = require("tls");
const fs = require("fs");
const https = require("https");

const ca = fs.readFileSync("C:/Users/jwalt/AppData/Roaming/velocity-app/certs/velocity-ca.crt");
const body = JSON.stringify({ account_id: "364d28ceb39aea833ab2b1323819bb05" });

const req = https.request(
  {
    hostname: "127.0.0.1",
    port: 8443,
    path: "/caldera/api/v1/launcher/racp",
    method: "POST",
    headers: {
      Host: "caldera-service-prod.ecosec.on.epicgames.com",
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    },
    servername: "caldera-service-prod.ecosec.on.epicgames.com",
    ca,
    rejectUnauthorized: true,
  },
  (res) => {
    let data = "";
    res.on("data", (c) => (data += c));
    res.on("end", () => {
      console.log("status", res.statusCode);
      console.log(data);
    });
  }
);
req.on("error", (e) => console.error("error", e.message));
req.write(body);
req.end();
