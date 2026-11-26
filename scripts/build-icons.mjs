// Renders the extension icons, the web app's home-screen icons, and the iPhone app's icons from public/favicon.svg.
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
// The iPhone app (mobile/): a full-bleed 1024px icon (iOS masks it) and a favicon for its web preview.
await sharp(square, { density: 2400 }).resize(1024, 1024).flatten({ background: "#0f766e" }).png().toFile(out("../mobile/assets/icon.png"));
await sharp(svg, { density: 384 }).resize(48, 48).png().toFile(out("../mobile/assets/favicon.png"));
console.log("icons written to extension/icons/, public/icons/, and mobile/assets/");
