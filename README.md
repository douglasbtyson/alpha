# troonooz

**Can you trust it?** troonooz uses Claude to check screenshots of social media posts and content captured from your browser for three things:

| Check | What it looks at |
|---|---|
| **News legitimacy** | Pulls out the checkable claims, searches for independent corroboration, and flags recycled stories, impersonated or satirical sources, misattributed quotes, and manipulation tactics. |
| **Vendor trustworthiness** | Identifies the seller, store, or advertiser; looks up reviews, complaints, regulator warnings, and domain age; spots scam patterns like fake discounts, countdown urgency, and payment methods with no buyer protection. |
| **Image & video authenticity** | Zooms into fine detail for signs of AI generation or editing, spots fabricated post and article screenshots, reads embedded provenance metadata (C2PA, IPTC AI labels, generator settings), samples frames from video, and searches for the original context. |

Every report has an overall trust score (0–100), a verdict and confidence level, red flags, per-section findings, recommendations, cited sources, and stated limitations. Each cited source is checked against the URLs the research actually returned, and any source that wasn't among them is flagged.

There are two ways to submit content:

- **Web app**: drop, paste (<kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>V</kbd>), or browse for screenshots, photos, and videos, and add text or links.
- **Chrome extension**: select a post or area on any page, check the whole visible page, capture frames from a playing video, or right-click an image, link, or selected text.

## Quick start

Requires Node.js 20.12+ (22 recommended). `ffmpeg` is optional; it enables server-side frame extraction for raw video uploads.

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...      # or put it in .env (see .env.example), or use `ant auth login`
npm run dev                              # http://localhost:8787
```

To try the interface without an API key, run `npm run demo`. Every check then returns one of two fixed sample reports, and they are clearly labelled as demo data.

For production, run `npm run build && npm start`.

### Install the browser extension

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose the `extension/` folder.
3. The extension talks to `http://localhost:8787` by default. To use a different server, open the extension's **Settings**. Settings is also where you enter an API token and allow fetching full-resolution originals for right-click image checks.

Ways to use it:

- **Toolbar popup** (<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd>) offers *Select a post or area*, *Check this page*, and *Capture a playing video* (5 frames over about 5 seconds).
- **Right-click menu** offers *check this image*, *check this video*, *fact-check "selected text"*, *check this link*, *check this page*, and *select an area*.

Each check opens its live report in a new tab of the web app.

## How it works

```
 screenshots / photos / video / page capture / text / links
        │
        ▼
 Evidence prep (server, no AI)
   • EXIF-orient, fit images to Claude's 2576px / 3.75MP vision limit,
     tile long scrolling screenshots instead of shrinking them
   • sample video frames (browser-side, or ffmpeg on the server)
   • provenance scan: C2PA manifests, IPTC "trainedAlgorithmicMedia",
     generator settings in PNG text chunks, editing software
   • domain registration age via RDAP
        │
        ▼
 Claude (claude-opus-5-5, adaptive thinking, streaming), agentic loop
   • web_search / web_fetch (server tools) to verify claims and vendors
   • inspect_region (our tool) to zoom into the full-resolution original
   • submit_report (strict JSON schema) to finish
        │
        ▼
 Grounding: cited URLs are checked against what the research actually returned
        │
        ▼
 Report saved to data/reports/<id>.json, streamed live to the UI over SSE
```

Key files:

| Path | Purpose |
|---|---|
| `src/analysis/prompts.ts` | System prompt: investigation method, calibration rules, scoring rubric |
| `src/analysis/schema.ts` | Report schema (Zod; converted to the strict `submit_report` tool schema) |
| `src/analysis/analyzer.ts` | The Claude loop: tools, `pause_turn`, refusal/`max_tokens` handling, retries, zoom tool |
| `src/analysis/evidence.ts` | Turns uploads into labelled image blocks and fenced untrusted text |
| `src/analysis/images.ts` | Resizing, tiling, zoom crops (sharp) |
| `src/analysis/metadata.ts` | Provenance and EXIF signals |
| `src/analysis/grounding.ts` | Source-URL ledger and grounding check |
| `src/server/app.ts` | HTTP API, job runner, SSE |
| `public/` | Web app (vanilla JS, no build step) |
| `extension/` | Chrome MV3 extension |

### Design choices worth knowing

- **Prompt-injection resistance.** Page text, captions, and pasted content go into fenced blocks marked as untrusted. The model is told never to follow instructions inside them, and to report any attempt as a red flag.
- **Calibration over confidence.** The prompt separates "unverifiable" from "false" and treats missing metadata as no evidence either way. It also asks for "inconclusive" when the visual signals are weak.
- **Refusal fallbacks.** Requests send `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`). If the model declines on a safety-classifier false positive, the API re-runs the request on a fallback model. Set `TROONOOZ_FALLBACKS=off` if a proxy in front of the API rejects the beta.
- **Prompt caching.** The system prompt and tools are byte-stable and cached. The evidence turn is cached too, so continuation turns (after searches or zooms) re-read the images from cache.

## Configuration

All settings are environment variables; `.env` is loaded automatically. See `.env.example`.

| Variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | – | Claude API key (or `ANTHROPIC_AUTH_TOKEN` / an `ant auth login` profile) |
| `PORT` / `HOST` | `8787` / `127.0.0.1` | Listen address |
| `TROONOOZ_API_TOKEN` | – | Require `Authorization: Bearer <token>` on `/api` (set this before exposing the server) |
| `TROONOOZ_MODEL` | `claude-opus-5-5` | Model |
| `TROONOOZ_EFFORT` | `high` | `low` · `medium` · `high` · `xhigh` · `max` |
| `TROONOOZ_FALLBACKS` | `on` | Server-side refusal fallbacks |
| `TROONOOZ_WEB_SEARCH_MAX_USES` | `8` | Searches per check (0 disables) |
| `TROONOOZ_WEB_FETCH_MAX_USES` | `5` | Page fetches per check (0 disables) |
| `TROONOOZ_MAX_ZOOMS` | `6` | `inspect_region` calls per check (0 disables) |
| `TROONOOZ_RDAP` | `on` | Domain-age lookups via rdap.org |
| `TROONOOZ_MAX_FILES` / `_MAX_FILE_MB` | `20` / `100` | Upload limits |
| `TROONOOZ_MAX_IMAGES` | `40` | Images sent to Claude per check (after tiling and frame sampling) |
| `TROONOOZ_VIDEO_FRAMES` | `8` | Frames sampled per server-processed video |
| `TROONOOZ_MAX_CONCURRENT` | `3` | Concurrent checks (more get HTTP 429) |
| `TROONOOZ_DATA_DIR` | `data` | Where reports are stored |
| `TROONOOZ_DEMO` | `0` | Fixed sample reports, no API calls |

## API

`POST /api/analyze` takes `multipart/form-data` and returns `202 {id, events_url, report_url, view_url}`.

| Field | Type | Notes |
|---|---|---|
| `files` | file (repeatable) | Images or videos |
| `frames` + `frame_info` | files + JSON array | Pre-extracted video frames, with `[{video, time, duration}]` in the same order |
| `text` | string | Pasted post text or context |
| `urls` | JSON array or newline list | Links to check |
| `image_urls` | JSON array | Remote images. The Claude API fetches these; this server never does. |
| `page` | JSON | Browser capture: `{url, title, site_name, description, author, published, canonical, lang, selection, text, capture_mode}` |
| `focus` | JSON array | Any of `news`, `vendor`, `media`. Empty means check everything relevant. |
| `web` | `true`/`false` | Live web research (default `true`) |
| `source` | `web`/`extension`/`api` | Where the request came from |

Other endpoints:

- `GET /api/jobs/:id/events` is a Server-Sent Events stream of `progress` events (`status`, `thinking`, `search`, `fetch`, `zoom`, `writing`, `fallback`) that ends with `done` or `error`. Because `EventSource` can't send headers, this endpoint also accepts the token as `?token=`.
- `GET /api/reports/:id` returns the full record (report, inputs, thumbnails, automated signals, research log, token usage). `GET /api/reports` lists recent reports, and `DELETE /api/reports/:id` deletes one.
- `GET /api/health` returns the server status.

Example:

```bash
curl -F files=@post.png -F 'focus=["news"]' http://localhost:8787/api/analyze
```

## Privacy and security

- Submitted content and screenshots go to the Anthropic API for analysis. With RDAP on, the domain names of submitted links also go to rdap.org.
- Reports, including small thumbnails, are stored as JSON files in `TROONOOZ_DATA_DIR` on your server.
- The extension sends data only when you click one of its actions, and only to the server address you configured.
- The server listens on localhost by default. Before exposing it, set `TROONOOZ_API_TOKEN`, because every check spends API credits.
- The web UI renders all model output and page content as text (never as HTML) under a strict Content-Security-Policy, and only http(s) links are made clickable.

## Limitations

- troonooz cannot run a reverse image search. Provenance relies on web search for the scene or event, on metadata, and on visual inspection.
- AI-image and deepfake detection by inspection is probabilistic. A clean result is not proof of authenticity, and the reports say so.
- For video, troonooz sees sampled frames only, so motion, audio, and lip-sync are not evaluated.
- Social platforms strip metadata, so most screenshots carry no provenance signals.
- Results depend on what is findable on the web at the time of the check. Breaking news may simply be unverifiable yet.

## Development

```bash
npm test            # vitest: schema, metadata, imaging, grounding, analyzer loop (scripted model), HTTP API, ffmpeg
npm run typecheck
npm run build
```

The analyzer takes a `Streamer` function, so tests and demo mode can substitute a scripted model (`src/analysis/demo.ts`, `test/helpers.ts`). The real implementation wraps `client.beta.messages.stream(...)`.
