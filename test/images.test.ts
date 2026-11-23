import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { MAX_EDGE, MAX_IMAGE_BYTES, MAX_PIXELS, prepareImage, zoomCrop } from "../src/analysis/images.js";
import { solidJpeg, solidPng } from "./helpers.js";

describe("prepareImage", () => {
  it("leaves a normal screenshot at native size", async () => {
    const { info, blocks } = await prepareImage(await solidPng(1170, 2532));
    expect(info).toMatchObject({ width: 1170, height: 2532, format: "png" });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ width: 1170, height: 2532, mediaType: "image/png" });
  });

  it("scales large photos within the vision limits", async () => {
    const { blocks } = await prepareImage(await solidJpeg(6000, 4000));
    const b = blocks[0]!;
    expect(Math.max(b.width, b.height)).toBeLessThanOrEqual(MAX_EDGE);
    expect(b.width * b.height).toBeLessThanOrEqual(MAX_PIXELS);
    expect(b.mediaType).toBe("image/jpeg");
    expect(b.region).toEqual({ left: 0, top: 0, width: 6000, height: 4000 });
  });

  it("tiles a long scrolling screenshot top to bottom with overlap", async () => {
    const { blocks } = await prepareImage(await solidPng(1080, 9000));
    expect(blocks.length).toBeGreaterThan(1);
    expect(blocks.length).toBeLessThanOrEqual(6);
    for (const b of blocks) {
      expect(Math.max(b.width, b.height)).toBeLessThanOrEqual(MAX_EDGE);
      expect(b.width * b.height).toBeLessThanOrEqual(MAX_PIXELS);
      expect(b.data.length).toBeLessThanOrEqual(MAX_IMAGE_BYTES);
      expect(b.width).toBe(1080); // text stays at native width
    }
    expect(blocks[0]!.region.top).toBe(0);
    const last = blocks.at(-1)!.region;
    expect(last.top + last.height).toBe(9000);
    for (let i = 1; i < blocks.length; i++) {
      const prev = blocks[i - 1]!.region;
      expect(blocks[i]!.region.top).toBeLessThan(prev.top + prev.height); // overlapping
    }
  });

  it("caps tiles for extremely long captures by scaling down", async () => {
    const { blocks } = await prepareImage(await solidPng(800, 40000));
    expect(blocks.length).toBeLessThanOrEqual(6);
    expect(blocks.at(-1)!.region.top + blocks.at(-1)!.region.height).toBe(40000);
  });

  it("applies EXIF orientation", async () => {
    const rotated = await sharp({ create: { width: 300, height: 100, channels: 3, background: "#fff" } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const { info, blocks } = await prepareImage(rotated);
    expect(info).toMatchObject({ width: 100, height: 300 });
    expect(blocks[0]).toMatchObject({ width: 100, height: 300 });
  });
});

describe("zoomCrop", () => {
  it("maps sent-image coordinates back to the full-resolution original", async () => {
    // 4000x4000 original: white with a red square at (3000..3400, 3000..3400).
    const red = await sharp({ create: { width: 400, height: 400, channels: 3, background: "#ff0000" } }).png().toBuffer();
    const original = await sharp({ create: { width: 4000, height: 4000, channels: 3, background: "#ffffff" } })
      .composite([{ input: red, left: 3000, top: 3000 }])
      .png()
      .toBuffer();
    const { blocks } = await prepareImage(original);
    const sent = blocks[0]!;
    const scale = sent.width / 4000;
    const crop = await zoomCrop(original, sent, { x: 3000 * scale, y: 3000 * scale, width: 400 * scale, height: 400 * scale });
    expect(crop.crop.left).toBeGreaterThanOrEqual(2995);
    expect(crop.crop.left).toBeLessThanOrEqual(3005);
    expect(crop.crop.width).toBeGreaterThanOrEqual(395);
    const { data, info } = await sharp(crop.data).raw().toBuffer({ resolveWithObject: true });
    const mid = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
    expect([data[mid], data[mid + 1], data[mid + 2]]).toEqual([255, 0, 0]);
  });

  it("magnifies small regions and clamps out-of-range requests", async () => {
    const original = await solidPng(1000, 800);
    const { blocks } = await prepareImage(original);
    const crop = await zoomCrop(original, blocks[0]!, { x: 990, y: 790, width: 500, height: 500 });
    expect(crop.crop.left + crop.crop.width).toBeLessThanOrEqual(1000);
    expect(crop.crop.top + crop.crop.height).toBeLessThanOrEqual(800);
    const small = await zoomCrop(original, blocks[0]!, { x: 10, y: 10, width: 50, height: 40 });
    expect(small.width).toBe(200); // 4x magnification
  });
});
