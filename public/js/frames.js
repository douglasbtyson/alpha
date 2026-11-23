/**
 * Sample evenly spaced frames from a local video file in the browser, so only
 * a handful of JPEGs are uploaded instead of the whole video.
 */
export async function extractFrames(file, { count = 8, maxEdge = 1920, timeoutMs = 30000 } = {}) {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;

  const once = (event) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out reading the video")), timeoutMs);
      const ok = () => {
        clearTimeout(timer);
        video.removeEventListener("error", bad);
        resolve();
      };
      const bad = () => {
        clearTimeout(timer);
        video.removeEventListener(event, ok);
        reject(new Error("This browser cannot decode the video"));
      };
      video.addEventListener(event, ok, { once: true });
      video.addEventListener("error", bad, { once: true });
    });

  try {
    await once("loadedmetadata");
    let duration = video.duration;
    if (!Number.isFinite(duration)) {
      // Some WebM files report Infinity until the end has been seeked.
      video.currentTime = 1e9;
      await once("seeked");
      duration = video.duration;
      if (!Number.isFinite(duration)) throw new Error("Could not determine the video length");
    }
    const w = video.videoWidth;
    const hgt = video.videoHeight;
    if (!w || !hgt) throw new Error("The video has no picture");
    const scale = Math.min(1, maxEdge / Math.max(w, hgt));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(hgt * scale);
    const ctx = canvas.getContext("2d");

    const n = Math.max(1, Math.min(count, Math.ceil(duration * 2)));
    const frames = [];
    for (let i = 0; i < n; i++) {
      const t = ((i + 0.5) * duration) / n;
      video.currentTime = t;
      await once("seeked");
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
      if (blob) frames.push({ blob, time: Number(t.toFixed(3)) });
    }
    if (!frames.length) throw new Error("No frames could be captured");
    return { frames, duration, width: w, height: hgt, poster: URL.createObjectURL(frames[0].blob) };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
