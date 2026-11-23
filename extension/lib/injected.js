/*
 * Functions run inside the page with chrome.scripting.executeScript({ func }).
 * Each must be fully self-contained: no imports, no closures over module scope.
 */

/** Collect what the page says about itself plus its main readable text. */
export function extractPageContent() {
  const meta = (sel) => document.querySelector(sel)?.getAttribute("content")?.trim() || "";
  const pick = (...sels) => {
    for (const s of sels) {
      const v = meta(s);
      if (v) return v;
    }
    return "";
  };

  let ld = {};
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const j = JSON.parse(s.textContent || "");
      const items = Array.isArray(j) ? j : j["@graph"] || [j];
      const hit = items.find((it) => it && (it.datePublished || it.author || it.offers || it.seller));
      if (hit) {
        ld = hit;
        break;
      }
    } catch {
      // ignore malformed JSON-LD
    }
  }
  const ldAuthor = (() => {
    const a = ld.author;
    if (!a) return "";
    if (typeof a === "string") return a;
    if (Array.isArray(a)) return a.map((x) => (typeof x === "string" ? x : x?.name)).filter(Boolean).join(", ");
    return a.name || "";
  })();

  // Prefer the largest article/main region; fall back to the whole body.
  const regions = [...document.querySelectorAll("article, main, [role='main']")];
  let root = regions.sort((a, b) => (b.innerText || "").length - (a.innerText || "").length)[0];
  if (!root || (root.innerText || "").length < 400) root = document.body;
  const text = (root?.innerText || "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

  return {
    url: location.href,
    title: document.title || "",
    site_name: pick('meta[property="og:site_name"]', 'meta[name="application-name"]'),
    description: pick('meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]'),
    author: pick('meta[name="author"]', 'meta[property="article:author"]') || ldAuthor,
    published: pick('meta[property="article:published_time"]', 'meta[name="date"]', 'meta[itemprop="datePublished"]') || ld.datePublished || "",
    canonical: document.querySelector('link[rel="canonical"]')?.href || "",
    lang: document.documentElement.lang || "",
    selection: String(window.getSelection() || "").trim(),
    text: text.slice(0, 200000),
  };
}

/** Let the user drag a rectangle over the page. Resolves with the rect in CSS pixels, or null. */
export function selectArea() {
  return new Promise((resolve) => {
    const Z = "2147483647";
    const overlay = document.createElement("div");
    Object.assign(overlay.style, { position: "fixed", inset: "0", zIndex: Z, cursor: "crosshair", background: "rgba(15,23,42,0.28)" });
    const box = document.createElement("div");
    Object.assign(box.style, {
      position: "fixed",
      border: "2px solid #2dd4bf",
      background: "rgba(45,212,191,0.12)",
      boxShadow: "0 0 0 9999px rgba(15,23,42,0.28)",
      display: "none",
      pointerEvents: "none",
    });
    const hint = document.createElement("div");
    hint.textContent = "Drag over the post or area to check · Esc to cancel";
    Object.assign(hint.style, {
      position: "fixed",
      top: "16px",
      left: "50%",
      transform: "translateX(-50%)",
      padding: "8px 14px",
      borderRadius: "999px",
      background: "#0f766e",
      color: "#fff",
      font: "600 14px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      pointerEvents: "none",
      boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
    });
    overlay.append(box, hint);
    document.documentElement.append(overlay);

    let start = null;
    const rectTo = (e) => ({
      x: Math.min(start.x, e.clientX),
      y: Math.min(start.y, e.clientY),
      width: Math.abs(e.clientX - start.x),
      height: Math.abs(e.clientY - start.y),
    });
    const finish = (rect) => {
      overlay.remove();
      window.removeEventListener("keydown", onKey, true);
      // Wait for the overlay to disappear from the next painted frame before capturing.
      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => resolve(rect), 60)));
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        finish(null);
      }
    };
    overlay.addEventListener("mousedown", (e) => {
      e.preventDefault();
      start = { x: e.clientX, y: e.clientY };
      overlay.style.background = "transparent";
      box.style.display = "block";
      hint.style.display = "none";
    });
    overlay.addEventListener("mousemove", (e) => {
      if (!start) return;
      const r = rectTo(e);
      Object.assign(box.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` });
    });
    overlay.addEventListener("mouseup", (e) => {
      if (!start) return;
      const r = rectTo(e);
      start = null;
      if (r.width < 12 || r.height < 12) return finish(null);
      finish({ ...r, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight });
    });
    window.addEventListener("keydown", onKey, true);
  });
}

/** Small status toast in the page (used for context-menu actions, which have no popup). */
export function showToast(message, isError) {
  const id = "__troonooz_toast";
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement("div");
    el.id = id;
    el.setAttribute("role", "status");
    document.documentElement.append(el);
  }
  Object.assign(el.style, {
    position: "fixed",
    right: "16px",
    bottom: "16px",
    zIndex: "2147483647",
    maxWidth: "360px",
    padding: "10px 14px",
    borderRadius: "10px",
    background: isError ? "#b91c1c" : "#0f766e",
    color: "#fff",
    font: "600 14px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    boxShadow: "0 6px 20px rgba(0,0,0,0.25)",
  });
  el.textContent = message;
  clearTimeout(window.__troonoozToastTimer);
  window.__troonoozToastTimer = setTimeout(() => el.remove(), isError ? 9000 : 3500);
}
