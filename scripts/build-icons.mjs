// Renders the extension's PNG icons from public/favicon.svg.
import sharp from "sharp";
import { readFile } from "node:fs/promises";

const svg = await readFile(new URL("../public/favicon.svg", import.meta.url));
for (const size of [16, 32, 48, 128]) {
  await sharp(svg, { density: 384 }).resize(size, size).png().toFile(new URL(`../extension/icons/icon-${size}.png`, import.meta.url).pathname);
}
console.log("icons written to extension/icons/");
