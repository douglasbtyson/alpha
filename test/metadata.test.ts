import { crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { extractImageSignals, metadataRegion, pngTextKeywords, scanProvenance } from "../src/analysis/metadata.js";
import { solidJpeg, solidPng } from "./helpers.js";

/** Insert a PNG tEXt chunk before IEND. */
function withPngText(png: Buffer, keyword: string, text: string): Buffer {
  const data = Buffer.concat([Buffer.from(keyword, "latin1"), Buffer.from([0]), Buffer.from(text, "latin1")]);
  const type = Buffer.from("tEXt", "latin1");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([type, data])));
  const iend = png.length - 12;
  return Buffer.concat([png.subarray(0, iend), len, type, data, crc, png.subarray(iend)]);
}

/** Insert an XMP APP1 segment right after the JPEG SOI marker. */
function withXmp(jpeg: Buffer, xmp: string): Buffer {
  const payload = Buffer.concat([Buffer.from("http://ns.adobe.com/xap/1.0/\0", "latin1"), Buffer.from(xmp, "utf8")]);
  const header = Buffer.alloc(4);
  header.writeUInt16BE(0xffe1, 0);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), header, payload, jpeg.subarray(2)]);
}

const xmpPacket = (inner: string) =>
  `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" ${inner}/></rdf:RDF></x:xmpmeta>`;

describe("metadata signals", () => {
  it("finds PNG text chunk keywords from image generators", async () => {
    const png = withPngText(await solidPng(32, 32), "parameters", "a cat, Steps: 30, Sampler: Euler a, CFG scale: 7");
    expect(pngTextKeywords(png)).toContain("parameters");
    const { provenance } = scanProvenance(png);
    expect(provenance.some((p) => p.includes("Stable Diffusion"))).toBe(true);
  });

  it("detects IPTC DigitalSourceType declaring generative AI in JPEG XMP", async () => {
    const jpg = withXmp(
      await solidJpeg(64, 64),
      xmpPacket('Iptc4xmpExt:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia" xmp:CreatorTool="Adobe Firefly"'),
    );
    const sig = await extractImageSignals(jpg, { format: "jpeg", width: 64, height: 64 });
    expect(sig.provenance.some((p) => p.includes("trainedAlgorithmicMedia"))).toBe(true);
    expect(sig.provenance.some((p) => p.includes("Adobe Firefly"))).toBe(true);
    // The longer composite value must not also be reported.
    expect(sig.provenance.some((p) => p.includes("compositeWithTrainedAlgorithmicMedia"))).toBe(false);
  });

  it("reports editing software as a note, not provenance", async () => {
    const jpg = withXmp(await solidJpeg(64, 64), xmpPacket('xmp:CreatorTool="Adobe Photoshop 25.0"'));
    const sig = await extractImageSignals(jpg, { format: "jpeg", width: 64, height: 64 });
    expect(sig.provenance).toEqual([]);
    expect(sig.notes.join(" ")).toContain("Adobe Photoshop");
    expect(sig.notes.join(" ")).not.toMatch(/Photoshop, Photoshop/);
  });

  it("reports nothing for a plain image and notes missing camera data", async () => {
    const sig = await extractImageSignals(await solidJpeg(64, 64), { format: "jpeg", width: 64, height: 64 });
    expect(sig.provenance).toEqual([]);
    expect(sig.camera).toBeNull();
    expect(sig.notes.join(" ")).toMatch(/No camera or provenance metadata/);
  });

  it("scans only metadata segments, not compressed pixel data", async () => {
    const jpg = await solidJpeg(64, 64);
    // Plant a generator name after the SOS marker (inside "pixel data").
    const planted = Buffer.concat([jpg.subarray(0, jpg.length - 2), Buffer.from("Midjourney"), jpg.subarray(jpg.length - 2)]);
    expect(metadataRegion(planted).includes(Buffer.from("Midjourney"))).toBe(false);
    expect(scanProvenance(planted).provenance).toEqual([]);
  });
});
