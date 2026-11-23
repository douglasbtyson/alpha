import { api, ApiError, getToken, setToken, subscribe } from "./js/api.js";
import { fromTemplate, h, hostOf, timeAgo } from "./js/dom.js";
import { extractFrames } from "./js/frames.js";
import { CONTENT_TYPES, OVERALL, renderReport, scoreTone, summaryText } from "./js/render.js";

const view = document.getElementById("view");
let health = null;
let teardown = null;

/* ---------------- Check form state ---------------- */
// Survives navigation within the session so "back" doesn't lose attachments.
const state = { attachments: [] };
let attachmentSeq = 0;

function isVideoFile(file) {
  return file.type.startsWith("video/") || /\.(mp4|m4v|mov|webm|mkv|avi|3gp|ogv)$/i.test(file.name);
}

function addFiles(files) {
  for (const file of files) {
    if (!file.type.startsWith("image/") && !isVideoFile(file)) {
      showFormError(`"${file.name}" is not an image or video.`);
      continue;
    }
    const item = { id: ++attachmentSeq, file, kind: isVideoFile(file) ? "video" : "image", status: "ready", preview: null, frames: null, note: "" };
    if (item.kind === "image") {
      item.preview = URL.createObjectURL(file);
    } else {
      item.status = "processing";
      item.note = "Sampling frames…";
      extractFrames(file)
        .then((res) => {
          item.frames = res.frames;
          item.duration = res.duration;
          item.preview = res.poster;
          item.status = "ready";
          item.note = `${res.frames.length} frames · ${Math.round(res.duration)}s`;
        })
        .catch((err) => {
          // Fall back to uploading the whole video for server-side (ffmpeg) sampling.
          if (health?.server_video) {
            item.status = "ready";
            item.note = "Will be processed on the server";
          } else {
            item.status = "error";
            item.note = err.message;
          }
        })
        .finally(renderAttachments);
    }
    state.attachments.push(item);
  }
  renderAttachments();
}

function removeAttachment(id) {
  const idx = state.attachments.findIndex((a) => a.id === id);
  if (idx === -1) return;
  const [a] = state.attachments.splice(idx, 1);
  if (a.preview) URL.revokeObjectURL(a.preview);
  renderAttachments();
}

function renderAttachments() {
  const list = document.getElementById("attachments");
  if (!list) return;
  list.replaceChildren(
    ...state.attachments.map((a) =>
      h(
        "li",
        { class: "attachment" },
        a.preview
          ? h("img", { class: "attachment-media", src: a.preview, alt: "" })
          : h("div", { class: "attachment-media", role: "presentation" }),
        h(
          "div",
          { class: "attachment-meta" },
          h("span", { class: "attachment-name", title: a.file.name }, a.file.name),
          h("span", { class: `attachment-status ${a.status === "error" ? "error" : ""}` }, a.note || (a.kind === "video" ? "Video" : `${Math.max(1, Math.round(a.file.size / 1024))} KB`)),
        ),
        h("button", { type: "button", class: "attachment-remove", "aria-label": `Remove ${a.file.name}`, onclick: () => removeAttachment(a.id) }, "×"),
      ),
    ),
  );
}

function showFormError(message) {
  const el = document.getElementById("form-error");
  if (!el) return;
  el.textContent = message;
  el.hidden = !message;
}

function onPaste(e) {
  const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/") || isVideoFile(f));
  if (!files.length) return;
  e.preventDefault();
  // Clipboard screenshots arrive as "image.png"; give them distinguishable names.
  const named = files.map((f, i) =>
    f.name && f.name !== "image.png" ? f : new File([f], `pasted-screenshot-${Date.now()}-${i + 1}.png`, { type: f.type }),
  );
  addFiles(named);
}

function renderCheck() {
  view.replaceChildren(fromTemplate("tpl-check"));
  const form = document.getElementById("check-form");
  const drop = document.getElementById("dropzone");
  const input = document.getElementById("file-input");

  drop.addEventListener("click", () => input.click());
  drop.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      input.click();
    }
  });
  input.addEventListener("change", () => {
    addFiles([...input.files]);
    input.value = "";
  });
  for (const ev of ["dragenter", "dragover"]) {
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add("dragging");
    });
  }
  for (const ev of ["dragleave", "drop"]) {
    drop.addEventListener(ev, () => drop.classList.remove("dragging"));
  }
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    addFiles([...(e.dataTransfer?.files ?? [])]);
  });
  document.addEventListener("paste", onPaste);

  // "Everything relevant" is exclusive with the specific focus chips.
  const chips = [...form.querySelectorAll('input[name="focus"]')];
  for (const chip of chips) {
    chip.addEventListener("change", () => {
      if (chip.value === "auto" && chip.checked) chips.forEach((c) => c !== chip && (c.checked = false));
      if (chip.value !== "auto" && chip.checked) chips.find((c) => c.value === "auto").checked = false;
      if (!chips.some((c) => c.checked)) chips.find((c) => c.value === "auto").checked = true;
    });
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    submitCheck(form);
  });
  renderAttachments();

  return () => document.removeEventListener("paste", onPaste);
}

async function submitCheck(form) {
  showFormError("");
  const text = document.getElementById("text-input").value.trim();
  const urls = document
    .getElementById("urls-input")
    .value.split(/\s+/)
    .map((u) => u.trim())
    .filter(Boolean);
  const bad = urls.find((u) => !/^https?:\/\/\S+$/i.test(u));
  if (bad) return showFormError(`"${bad}" is not a valid http(s) link.`);
  if (state.attachments.some((a) => a.status === "processing")) return showFormError("Still sampling video frames — one moment.");
  const usable = state.attachments.filter((a) => a.status !== "error");
  if (!usable.length && !text && !urls.length) return showFormError("Add a screenshot, image, video, link, or some text to check.");

  const fd = new FormData();
  const frameInfo = [];
  for (const a of usable) {
    if (a.kind === "video" && a.frames) {
      a.frames.forEach((f, i) => {
        fd.append("frames", f.blob, `${a.file.name}-frame-${i + 1}.jpg`);
        frameInfo.push({ video: a.file.name, time: f.time, duration: a.duration });
      });
    } else {
      fd.append("files", a.file, a.file.name);
    }
  }
  if (frameInfo.length) fd.append("frame_info", JSON.stringify(frameInfo));
  if (text) fd.append("text", text);
  if (urls.length) fd.append("urls", JSON.stringify(urls));
  const focus = [...form.querySelectorAll('input[name="focus"]:checked')].map((c) => c.value).filter((v) => v !== "auto");
  fd.append("focus", JSON.stringify(focus));
  fd.append("web", document.getElementById("web-input").checked ? "true" : "false");
  fd.append("source", "web");

  const button = document.getElementById("submit-button");
  button.disabled = true;
  button.textContent = "Uploading…";
  try {
    const res = await api.analyze(fd);
    for (const a of state.attachments) if (a.preview) URL.revokeObjectURL(a.preview);
    state.attachments = [];
    location.hash = `#/report/${res.id}`;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) promptToken();
    showFormError(err.message);
    button.disabled = false;
    button.textContent = "Check it";
  }
}

/* ---------------- Report view ---------------- */
function stepFor(event) {
  switch (event.type) {
    case "status":
      return ["•", event.message];
    case "thinking":
      return ["…", "Reading the material"];
    case "search":
      return ["\u{1F50E}", `Searched: “${event.query}”`];
    case "results":
      return null;
    case "fetch":
      return ["\u{1F4C4}", `Reading ${hostOf(event.url)}`];
    case "zoom":
      return ["\u{1F50D}", `Zoomed into ${event.image}: ${event.reason}`];
    case "writing":
      return ["✍", "Writing the report"];
    case "fallback":
      return ["↻", `Continued on ${event.to}`];
    default:
      return null;
  }
}

function renderReportView(id) {
  view.replaceChildren(fromTemplate("tpl-report"));
  const progress = document.getElementById("progress");
  const steps = document.getElementById("progress-steps");
  const errorBox = document.getElementById("report-error");
  const reportEl = document.getElementById("report");
  let stop = () => {};
  let timer = null;
  let cancelled = false;

  const showError = (title, message) => {
    progress.hidden = true;
    errorBox.hidden = false;
    errorBox.replaceChildren(h("h2", {}, title), h("p", {}, message), h("a", { class: "btn", href: "#/" }, "Try again"));
  };

  const showReport = async () => {
    try {
      const record = await api.report(id);
      if (cancelled) return;
      if (record?.status === "running") return; // still running; events will follow
      progress.hidden = true;
      reportEl.hidden = false;
      document.title = `${record.report.verdict.headline} · troonooz`;
      renderReport(reportEl, record, {
        copyLink: async (e) => {
          await navigator.clipboard?.writeText(location.href);
          e.target.textContent = "Link copied";
        },
        copySummary: async (e) => {
          await navigator.clipboard?.writeText(summaryText(record));
          e.target.textContent = "Summary copied";
        },
        remove: async () => {
          if (!confirm("Delete this report? This cannot be undone.")) return;
          await api.deleteReport(id);
          location.hash = "#/history";
        },
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) promptToken();
      showError("Report not found", err.message);
    }
  };

  const startProgress = () => {
    progress.hidden = false;
    const started = Date.now();
    const elapsed = document.getElementById("progress-elapsed");
    timer = setInterval(() => {
      const s = Math.round((Date.now() - started) / 1000);
      elapsed.textContent = s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
    }, 1000);
    let lastKey = "";
    stop = subscribe(id, {
      progress: (e) => {
        const step = stepFor(e.event);
        if (!step) return;
        const key = step.join("|");
        if (key === lastKey) return;
        lastKey = key;
        steps.querySelector(".current")?.classList.remove("current");
        steps.append(h("li", { class: "step current" }, h("span", { class: "step-icon", "aria-hidden": "true" }, step[0]), h("span", { class: "step-text" }, step[1])));
        document.getElementById("progress-title").textContent = e.event.type === "writing" ? "Almost done…" : "Checking…";
      },
      done: () => {
        clearInterval(timer);
        showReport();
      },
      error: (e) => {
        clearInterval(timer);
        showError("The check could not be completed", e.message);
      },
      disconnected: () => {
        clearInterval(timer);
        // The job may have finished while we were away; try the stored report.
        showReport();
      },
    });
  };

  api
    .job(id)
    .then((job) => {
      if (cancelled) return;
      if (job.status === "done") showReport();
      else if (job.status === "error") {
        const err = job.events.find((e) => e.type === "error");
        showError("The check could not be completed", err?.message ?? "Unknown error");
      } else startProgress();
    })
    .catch((err) => {
      if (err instanceof ApiError && err.status === 401) promptToken();
      // Jobs are kept in memory for an hour; older reports are still on disk.
      showReport();
    });

  return () => {
    cancelled = true;
    stop();
    clearInterval(timer);
  };
}

/* ---------------- History ---------------- */
async function renderHistory() {
  view.replaceChildren(fromTemplate("tpl-history"));
  const list = document.getElementById("history-list");
  try {
    const { reports } = await api.reports();
    if (!reports.length) {
      list.replaceChildren(h("li", { class: "empty" }, "No checks yet. ", h("a", { href: "#/" }, "Run your first one.")));
      return;
    }
    list.replaceChildren(
      ...reports.map((r) => {
        const tone = scoreTone(r.trust_score, r.rating);
        const [label] = OVERALL[r.rating] ?? [r.rating];
        return h(
          "li",
          { class: "history-item" },
          h(
            "a",
            { href: `#/report/${r.id}` },
            r.thumbnail ? h("img", { class: "history-thumb", src: r.thumbnail, alt: "" }) : h("div", { class: "history-thumb" }),
            h(
              "div",
              {},
              h("p", { class: "history-title" }, r.headline),
              h("p", { class: "history-sub" }, [label, CONTENT_TYPES[r.content_type] ?? r.content_type, r.platform, timeAgo(r.created_at), r.demo ? "demo" : ""].filter(Boolean).join(" · ")),
            ),
            h("span", { class: `score-pill tone-${tone}`, "aria-label": `Trust score ${r.trust_score}` }, r.trust_score),
          ),
        );
      }),
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) promptToken();
    list.replaceChildren(h("li", { class: "empty" }, err.message));
  }
}

/* ---------------- Token dialog ---------------- */
function promptToken() {
  if (document.querySelector("dialog[open]")) return;
  const input = h("input", { type: "password", autocomplete: "off", placeholder: "API token", value: getToken() });
  const dialog = h(
    "dialog",
    {},
    h(
      "form",
      { method: "dialog" },
      h("h2", {}, "API token required"),
      h("p", { class: "muted" }, "This troonooz server requires a token. It is stored in this browser only."),
      input,
      h("div", { class: "dialog-actions" }, h("button", { class: "btn", value: "cancel" }, "Cancel"), h("button", { class: "btn btn-primary", value: "save" }, "Save")),
    ),
  );
  dialog.addEventListener("close", () => {
    if (dialog.returnValue === "save") {
      setToken(input.value.trim());
      route();
    }
    dialog.remove();
  });
  document.body.append(dialog);
  dialog.showModal();
}

/* ---------------- Router ---------------- */
function route() {
  teardown?.();
  teardown = null;
  document.title = "troonooz";
  const hash = location.hash || "#/";
  const m = hash.match(/^#\/report\/([A-Za-z0-9_-]+)/);
  let navKey = "check";
  if (m) {
    navKey = "";
    teardown = renderReportView(m[1]);
  } else if (hash.startsWith("#/history")) {
    navKey = "history";
    renderHistory();
  } else {
    teardown = renderCheck();
  }
  for (const a of document.querySelectorAll("[data-nav]")) {
    if (a.dataset.nav === navKey) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  view.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

async function loadHealth() {
  const status = document.getElementById("server-status");
  try {
    health = await api.health();
    status.textContent = health.demo
      ? "Demo mode (sample data)"
      : health.claude_configured
        ? `Model: ${health.model}`
        : "Claude API key not configured on the server";
    const banner = document.getElementById("banner");
    if (health.demo) {
      banner.textContent = "Demo mode: every check returns a fixed sample report. Configure ANTHROPIC_API_KEY and unset TROONOOZ_DEMO for real analysis.";
      banner.hidden = false;
    } else if (!health.claude_configured) {
      banner.textContent = "The server has no Claude API key configured, so checks will fail. Set ANTHROPIC_API_KEY and restart.";
      banner.hidden = false;
    }
    const tokenButton = document.getElementById("token-button");
    if (health.auth_required) {
      tokenButton.hidden = false;
      tokenButton.onclick = promptToken;
      if (!getToken()) promptToken();
    }
  } catch {
    status.textContent = "Server unreachable";
  }
}

window.addEventListener("hashchange", route);
loadHealth();
route();
