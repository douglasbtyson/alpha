import { extractPageContent, selectArea, showToast } from "./lib/injected.js";
import { getSettings } from "./lib/settings.js";

/*
 * Service worker: captures what the user wants checked, sends it to the
 * troonooz server, and opens the live report in a new tab.
 */

const MENU = {
  page: "troonooz-page",
  area: "troonooz-area",
  image: "troonooz-image",
  video: "troonooz-video",
  selection: "troonooz-selection",
  link: "troonooz-link",
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU.page, title: "troonooz: check this page", contexts: ["page"] });
    chrome.contextMenus.create({ id: MENU.area, title: "troonooz: select an area to check", contexts: ["page", "frame"] });
    chrome.contextMenus.create({ id: MENU.image, title: "troonooz: check this image", contexts: ["image"] });
    chrome.contextMenus.create({ id: MENU.video, title: "troonooz: check this video (capture frames)", contexts: ["video"] });
    chrome.contextMenus.create({ id: MENU.selection, title: "troonooz: fact-check “%s”", contexts: ["selection"] });
    chrome.contextMenus.create({ id: MENU.link, title: "troonooz: check this link", contexts: ["link"] });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  const jobs = {
    [MENU.page]: () => scanPage(tab, []),
    [MENU.area]: () => scanArea(tab, []),
    [MENU.image]: () => checkImage(tab, info.srcUrl),
    [MENU.video]: () => captureVideo(tab, ["media"]),
    [MENU.selection]: () => checkSelection(tab, info.selectionText ?? ""),
    [MENU.link]: () => checkLink(tab, info.linkUrl),
  };
  run(tab, jobs[info.menuItemId]);
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "run") return false;
  chrome.tabs.get(msg.tabId).then((tab) => {
    const focus = Array.isArray(msg.focus) ? msg.focus : [];
    const jobs = {
      page: () => scanPage(tab, focus),
      area: () => scanArea(tab, focus),
      video: () => captureVideo(tab, focus),
    };
    run(tab, jobs[msg.action]);
  });
  sendResponse({ ok: true });
  return false;
});

// Handy from the service worker's DevTools console, e.g. `troonooz.scanPage(tab, [])`.
globalThis.troonooz = { scanPage, scanArea, captureVideo, checkImage, checkSelection, checkLink };

async function run(tab, job) {
  if (!job) return;
  try {
    await job();
  } catch (err) {
    const message = err?.message || String(err);
    console.error("troonooz:", err);
    const shown = await toast(tab.id, `troonooz: ${message}`, true);
    if (!shown) {
      // Pages like chrome:// can't show a toast; surface the error on the badge and in the popup.
      await chrome.storage.session.set({ lastError: message });
      await chrome.action.setBadgeBackgroundColor({ color: "#b91c1c" });
      await chrome.action.setBadgeText({ text: "!" });
    }
  }
}

async function toast(tabId, message, isError = false) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, func: showToast, args: [message, isError] });
    return true;
  } catch {
    return false;
  }
}

/** Page metadata and text. Falls back to the tab's URL and title where scripts can't run. */
async function pageContext(tab) {
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractPageContent });
    if (res?.result) return res.result;
  } catch {
    // restricted page
  }
  return { url: tab.url ?? "", title: tab.title ?? "" };
}

async function captureVisible(tab) {
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  return (await fetch(dataUrl)).blob();
}

async function crop(blob, rect) {
  const bitmap = await createImageBitmap(blob);
  // Derive the scale from the capture itself: it accounts for both devicePixelRatio and zoom.
  const scale = bitmap.width / rect.viewportWidth;
  const sx = Math.max(0, Math.round(rect.x * scale));
  const sy = Math.max(0, Math.round(rect.y * scale));
  const sw = Math.min(bitmap.width - sx, Math.round(rect.width * scale));
  const sh = Math.min(bitmap.height - sy, Math.round(rect.height * scale));
  const canvas = new OffscreenCanvas(sw, sh);
  canvas.getContext("2d").drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  bitmap.close();
  return canvas.convertToBlob({ type: "image/png" });
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

async function submit(tab, parts) {
  const { serverUrl, token } = await getSettings();
  const fd = new FormData();
  for (const f of parts.files ?? []) fd.append("files", f.blob, f.name);
  if (parts.frames?.length) {
    parts.frames.forEach((f, i) => fd.append("frames", f.blob, `frame-${i + 1}.png`));
    fd.append("frame_info", JSON.stringify(parts.frames.map((f) => ({ video: parts.videoName, time: f.time }))));
  }
  if (parts.page) fd.append("page", JSON.stringify(parts.page));
  if (parts.text) fd.append("text", parts.text);
  if (parts.urls?.length) fd.append("urls", JSON.stringify(parts.urls));
  if (parts.imageUrls?.length) fd.append("image_urls", JSON.stringify(parts.imageUrls));
  fd.append("focus", JSON.stringify(parts.focus ?? []));
  fd.append("source", "extension");
  const { quick } = await chrome.storage.local.get("quick");
  fd.append("mode", quick ? "quick" : "thorough");

  await toast(tab.id, "troonooz: sending to your troonooz server…");
  let res;
  try {
    res = await fetch(`${serverUrl}/api/analyze`, {
      method: "POST",
      body: fd,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  } catch {
    throw new Error(`Could not reach the troonooz server at ${serverUrl}. Is it running? (Change the address in the extension options.)`);
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    // ignore
  }
  if (res.status === 401) throw new Error("The server needs an API token. Add it in the extension options.");
  if (!res.ok) throw new Error(body?.message ?? `Server error (HTTP ${res.status})`);
  await chrome.action.setBadgeText({ text: "" });
  await chrome.tabs.create({ url: `${serverUrl}/#/report/${encodeURIComponent(body.id)}`, index: tab.index + 1 });
}

async function scanPage(tab, focus) {
  const [shot, page] = await Promise.all([captureVisible(tab), pageContext(tab)]);
  await submit(tab, {
    files: [{ blob: shot, name: `screenshot-${stamp()}.png` }],
    page: { ...page, capture_mode: "page" },
    focus,
  });
}

async function scanArea(tab, focus) {
  let rect;
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: selectArea });
    rect = res?.result;
  } catch {
    throw new Error("Area selection isn't available on this page. Use “check this page” instead.");
  }
  if (!rect) return; // cancelled
  const [shot, page] = await Promise.all([captureVisible(tab), pageContext(tab)]);
  const area = await crop(shot, rect);
  await submit(tab, {
    files: [{ blob: area, name: `selected-area-${stamp()}.png` }],
    page: { ...page, text: "", capture_mode: "area" },
    focus,
  });
}

/** Screenshots of the visible tab ~1s apart while a video plays. captureVisibleTab allows ~2 calls/second. */
async function captureVideo(tab, focus) {
  const COUNT = 5;
  const INTERVAL = 1000;
  await toast(tab.id, "troonooz: capturing 5 frames — keep the video playing and visible…");
  const frames = [];
  for (let i = 0; i < COUNT; i++) {
    if (i) await new Promise((r) => setTimeout(r, INTERVAL));
    frames.push({ blob: await captureVisible(tab), time: (i * INTERVAL) / 1000 });
  }
  const page = await pageContext(tab);
  await submit(tab, {
    frames,
    videoName: `Screen capture of “${(tab.title ?? "video").slice(0, 80)}”`,
    page: { ...page, text: (page.text ?? "").slice(0, 5000), capture_mode: "video" },
    focus: focus.length ? focus : ["media"],
  });
}

async function checkImage(tab, srcUrl) {
  if (!srcUrl) throw new Error("Could not find the image's address.");
  const page = await pageContext(tab);
  const parts = { page: { ...page, text: (page.text ?? "").slice(0, 8000), capture_mode: "image", image_url: srcUrl.startsWith("data:") ? "" : srcUrl }, focus: ["media"] };

  // Prefer the original file (full resolution + metadata). The service worker can fetch it when the
  // user granted site access; otherwise the server passes the URL to Claude, which fetches it.
  let blob = null;
  if (srcUrl.startsWith("data:")) {
    blob = await (await fetch(srcUrl)).blob();
  } else if (/^https?:/i.test(srcUrl)) {
    try {
      const origin = `${new URL(srcUrl).origin}/*`;
      if (await chrome.permissions.contains({ origins: [origin] })) {
        const res = await fetch(srcUrl, { credentials: "omit" });
        if (res.ok && (res.headers.get("content-type") ?? "").startsWith("image/")) blob = await res.blob();
      }
    } catch {
      blob = null;
    }
  }
  if (blob) {
    const ext = (blob.type.split("/")[1] || "png").replace("jpeg", "jpg").replace(/[^a-z0-9]/gi, "");
    const name = decodeURIComponent(new URL(srcUrl, "https://x").pathname.split("/").pop() || "") || `image.${ext}`;
    parts.files = [{ blob, name: name.slice(0, 120) }];
  } else if (/^https?:/i.test(srcUrl)) {
    parts.imageUrls = [srcUrl];
  } else {
    // blob: URLs and similar can't be fetched from here; capture what's on screen instead.
    parts.files = [{ blob: await captureVisible(tab), name: `screenshot-${stamp()}.png` }];
  }
  await submit(tab, parts);
}

async function checkSelection(tab, selectionText) {
  const page = await pageContext(tab);
  await submit(tab, {
    page: { ...page, selection: selectionText || page.selection || "", text: (page.text ?? "").slice(0, 15000), capture_mode: "selection" },
    focus: ["news"],
  });
}

async function checkLink(tab, linkUrl) {
  if (!linkUrl) throw new Error("Could not find the link's address.");
  const page = await pageContext(tab);
  await submit(tab, {
    urls: [linkUrl],
    page: { url: page.url, title: page.title, site_name: page.site_name, capture_mode: "link", link_url: linkUrl },
    focus: [],
  });
}
