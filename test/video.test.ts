import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { extractVideoFrames, hasFfmpeg } from "../src/analysis/video.js";

const run = promisify(execFile);
const ffmpeg = await hasFfmpeg();

describe.skipIf(!ffmpeg)("server-side video frames (ffmpeg)", () => {
  it("probes a clip and samples evenly spaced frames", async () => {
    const dir = await mkdtemp(join(tmpdir(), "troonooz-vid-"));
    try {
      const file = join(dir, "clip.mp4");
      await run("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc=duration=2:size=320x240:rate=10", "-pix_fmt", "yuv420p", file]);
      const { probe, frames } = await extractVideoFrames(await readFile(file), 4);
      expect(probe.duration).toBeCloseTo(2, 0);
      expect(probe).toMatchObject({ width: 320, height: 240, codec: "h264" });
      expect(frames.map((f) => f.time)).toEqual([0.25, 0.75, 1.25, 1.75]);
      for (const f of frames) expect(f.buffer.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects files without a video stream", async () => {
    await expect(extractVideoFrames(Buffer.from("definitely not a video"), 2)).rejects.toThrow();
  });
});
