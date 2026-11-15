// Tiny "build": substitutes API_URL/WS_URL into the static template at
// deploy time, so the same source works against any backend without a
// framework. Node's stdlib is enough — no dependencies needed for this
// throwaway deploy-check page.
const fs = require("fs");
const path = require("path");

const apiURL = process.env.API_URL;
const wsURL = process.env.WS_URL;

if (!apiURL || !wsURL) {
  console.error("build: API_URL and WS_URL env vars are both required");
  process.exit(1);
}

const template = fs.readFileSync(path.join(__dirname, "index.template.html"), "utf8");
const output = template.replaceAll("__API_URL__", apiURL).replaceAll("__WS_URL__", wsURL);

fs.mkdirSync(path.join(__dirname, "dist"), { recursive: true });
fs.writeFileSync(path.join(__dirname, "dist", "index.html"), output);

console.log("build: wrote dist/index.html");
