import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { scanProvenance } from "./metadata.js";

const run = promisify(execFile);

export interface VideoProbe {
  duration: number | null;
  width: number | null;
  height: number | null;
  codec: string | null;
  tags: Record<string, string>;
  provenance: string[];
  notes: string[];
}

export interface ExtractedFrame {
  time: number;
  buffer: Buffer;
}

let ffmpegAvailable: boolean | null = null;

export async function hasFfmpeg(): Promise<boolean> {
  if (ffmpegAvailable !== null) return ffmpegAvailable;
  try {
    await run("ffmpeg", ["-version"], { timeout: 5000 });
    await run("ffprobe", ["-version"], { timeout: 5000 });
    ffmpegAvailable = true;
  } catch {
    ffmpegAvailable = false;
  }
  return ffmpegAvailable;
}

const INTERESTING_TAGS = [
  "encoder",
  "creation_time",
  "handler_name",
  "com.apple.quicktime.make",
  "com.apple.quicktime.model",
  "com.apple.quicktime.software",
  "com.apple.quicktime.creationdate",
  "com.android.manufacturer",
  "com.android.model",
  "software",
  "comment",
  "title",
  "artist",
];

/**
 * Probe a video and sample `count` evenly spaced frames with ffmpeg.
 * Frames are JPEGs at most 2560px wide (the analyzer downsizes what it sends
 * and keeps these for zoom-ins).
 */
export async function extractVideoFrames(
  video: Buffer,
  count: number,
): Promise<{ probe: VideoProbe; frames: ExtractedFrame[] }> {
  if (!(await hasFfmpeg())) {
    throw new Error(
      "Server-side video processing needs ffmpeg and ffprobe on the PATH. Install ffmpeg, or upload frames extracted in the browser (the web app does this automatically).",
    );
  }
  const dir = await mkdtemp(join(tmpdir(), "troonooz-"));
  const file = join(dir, "input");
  try {
    await writeFile(file, video);
    const { stdout } = await run(
      "ffprobe",
      ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file],
      { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 },
    );
    const info = JSON.parse(stdout) as {
      format?: { duration?: string; tags?: Record<string, string> };
      streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number; duration?: string; tags?: Record<string, string> }>;
    };
    const vstream = info.streams?.find((s) => s.codec_type === "video");
    if (!vstream) throw new Error("The uploaded file has no video stream.");
    const durationRaw = Number.parseFloat(info.format?.duration ?? vstream.duration ?? "");
    const duration = Number.isFinite(durationRaw) && durationRaw > 0 ? durationRaw : null;

    const tags: Record<string, string> = {};
    for (const source of [info.format?.tags ?? {}, vstream.tags ?? {}]) {
      for (const [k, v] of Object.entries(source)) {
        if (INTERESTING_TAGS.includes(k.toLowerCase()) && v) tags[k.toLowerCase()] = String(v).slice(0, 200);
      }
    }
    const { provenance, editors } = scanProvenance(video);
    const notes: string[] = [];
    if (editors.length) notes.push(`Container metadata mentions editing software: ${editors.join(", ")}`);
    if (!tags["com.apple.quicktime.make"] && !tags["com.android.manufacturer"]) {
      notes.push("No capture-device metadata (normal for re-uploaded or downloaded social media video)");
    }

    const n = Math.max(1, count);
    const times =
      duration === null ? [0] : Array.from({ length: n }, (_, i) => Number((((i + 0.5) * duration) / n).toFixed(3)));
    const frames: ExtractedFrame[] = [];
    for (const t of times) {
      const { stdout: jpg } = await run(
        "ffmpeg",
        [
          "-v", "error",
          "-ss", String(t),
          "-i", file,
          "-frames:v", "1",
          "-vf", "scale='min(2560,iw)':-2",
          "-f", "image2pipe",
          "-c:v", "mjpeg",
          "-q:v", "3",
          "pipe:1",
        ],
        { timeout: 60_000, encoding: "buffer", maxBuffer: 64 * 1024 * 1024 },
      );
      if (jpg.length > 0) frames.push({ time: t, buffer: jpg });
    }
    if (frames.length === 0) throw new Error("Could not decode any frames from the uploaded video.");

    return {
      probe: {
        duration,
        width: vstream.width ?? null,
        height: vstream.height ?? null,
        codec: vstream.codec_name ?? null,
        tags,
        provenance,
        notes,
      },
      frames,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function describeProbe(p: VideoProbe): string {
  const parts: string[] = [];
  if (p.duration !== null) parts.push(`duration ${p.duration.toFixed(1)}s`);
  if (p.width && p.height) parts.push(`${p.width}x${p.height}`);
  if (p.codec) parts.push(`codec ${p.codec}`);
  for (const [k, v] of Object.entries(p.tags)) parts.push(`${k}: ${v}`);
  for (const pr of p.provenance) parts.push(`PROVENANCE: ${pr}`);
  parts.push(...p.notes);
  return parts.join("; ");
}
