// Renders the extension icons and the web app's home-screen icons from public/favicon.svg.
import sharp from "sharp";
import { mkdir, readFile } from "node:fs/promises";

const svg = await readFile(new URL("../public/favicon.svg", import.meta.url));
// Home-screen icons are full-bleed squares: iOS and Android apply their own rounded mask.
const square = Buffer.from(svg.toString().replace(/rx="\d+"/, 'rx="0"'));
const out = (p) => new URL(p, import.meta.url).pathname;

for (const size of [16, 32, 48, 128]) {
  await sharp(svg, { density: 384 }).resize(size, size).png().toFile(out(`../extension/icons/icon-${size}.png`));
}
await mkdir(out("../public/icons"), { recursive: true });
for (const [name, size] of [["apple-touch-icon", 180], ["icon-192", 192], ["icon-512", 512]]) {
  await sharp(square, { density: 1200 }).resize(size, size).png().toFile(out(`../public/icons/${name}.png`));
}
console.log("icons written to extension/icons/ and public/icons/");
