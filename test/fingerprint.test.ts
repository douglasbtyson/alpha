import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { imagePrint, normalizeText, sameImage, textHash, videoOverlap } from "../src/knowledge/fingerprint.js";
import { photo, postScreenshot, solidPng } from "./helpers.js";

const POST = "SHARK on I-95 right now!! Stay inside!! This is crazy everyone share";

async function same(a: Buffer, b: Buffer) {
  return sameImage((await imagePrint("a", a))!, (await imagePrint("b", b))!);
}

describe("image fingerprints", () => {
  it("recognise the same photo after resizing, recompression, format change, and brightness shifts", async () => {
    const p = await photo(1);
    expect(await same(p, await sharp(p).resize(400).jpeg({ quality: 60 }).toBuffer())).toBe(true);
    expect(await same(p, await sharp(p).resize(1600).webp({ quality: 50 }).toBuffer())).toBe(true);
    expect(await same(p, await sharp(p).modulate({ brightness: 1.15 }).toBuffer())).toBe(true);
  });

  it("recognise the same post screenshot after a re-share", async () => {
    const s = await postScreenshot(POST);
    expect(await same(s, await sharp(s).resize(828).jpeg({ quality: 70 }).toBuffer())).toBe(true);
    expect(await same(s, await sharp(s).webp({ quality: 60 }).toBuffer())).toBe(true);
  });

  it("tell apart posts that share a layout but differ in text, by even one word or a price", async () => {
    const s = await postScreenshot(POST);
    expect(await same(s, await postScreenshot("Gas prices will drop to one dollar next week says governor"))).toBe(false);
    expect(await same(s, await postScreenshot(POST.replace("crazy", "funny")))).toBe(false);
    expect(await same(s, await postScreenshot(POST.replace("I-95", "I-59")))).toBe(false);
    expect(await same(s, await postScreenshot(POST, "$99.9"))).toBe(false);
  });

  it("treat different photos and crops as different", async () => {
    const p = await photo(1);
    expect(await same(p, await photo(2))).toBe(false);
    expect(await same(p, await sharp(p).extract({ left: 20, top: 15, width: 760, height: 570 }).toBuffer())).toBe(false);
  });

  it("decline to fingerprint featureless images", async () => {
    expect(await imagePrint("x", await solidPng(300, 300))).toBeNull();
  });
});

describe("video and text fingerprints", () => {
  it("measures frame overlap between videos", () => {
    const a = ["0".repeat(64), "f".repeat(64), "0f".repeat(32)].join(",");
    expect(videoOverlap(a, a)).toBe(1);
    expect(videoOverlap(a, ["0".repeat(64)].join(","))).toBeCloseTo(1 / 3);
  });

  it("normalizes case, punctuation, whitespace, and tracking parameters", () => {
    const a = "BREAKING: Shark on I-95!!  See https://www.example.org/story?utm_source=fb";
    const b = "breaking shark on i-95 see http://example.org/story";
    expect(normalizeText(a)).toBe(normalizeText(b));
    expect(textHash(`${a} and stay safe out there`)).toBe(textHash(`${b} and stay safe out there`));
  });

  it("ignores short notes", () => {
    expect(textHash("is this real?")).toBeNull();
  });
});
