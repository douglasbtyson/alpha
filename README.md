# troonooz

**Can you trust it?** troonooz uses Claude to check screenshots of social media posts and content captured from your browser for three things:

| Check | What it looks at |
|---|---|
| **News legitimacy** | Pulls out the checkable claims, searches for independent corroboration, and flags recycled stories, impersonated or satirical sources, misattributed quotes, and manipulation tactics. |
| **Vendor trustworthiness** | Identifies the seller, store, or advertiser; looks up reviews, complaints, regulator warnings, and domain age; spots scam patterns like fake discounts, countdown urgency, and payment methods with no buyer protection. |
| **Image & video authenticity** | Zooms into fine detail for signs of AI generation or editing, spots fabricated post and article screenshots, reads embedded provenance metadata (C2PA, IPTC AI labels, generator settings), samples frames from video, and searches for the original context. |

troonooz also remembers what it has learned. If someone checks content that was already checked, they get the earlier result instantly at no cost. Findings about claims, sellers, accounts, and images also carry over to new checks (see [Shared knowledge](#shared-knowledge)).

Every report starts with a plain-language **What's going on**: the background of what you're looking at, with **Explain more** for deeper sections (who's involved, how we got here, why it's circulating, what's disputed).

Every report has an overall trust score (0–100), a verdict and confidence level, red flags, per-section findings, recommendations, cited sources, and stated limitations. Each cited source is checked against the URLs the research actually returned, and any source that wasn't among them is flagged.

There are two ways to submit content:

- **Web app**: drop, paste (<kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>V</kbd>), or browse for screenshots, photos, and videos, and add text or links.
- **Chrome extension**: select a post or area on any page, check the whole visible page, capture frames from a playing video, or right-click an image, link, or selected text.

## Quick start

Requires Node.js 22.13+ (it uses Node's built-in SQLite). `ffmpeg` is optional; it enables server-side frame extraction for raw video uploads.

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...      # or put it in .env (see .env.example), or use `ant auth login`
npm run dev                              # http://localhost:8787
```

To try the interface without an API key, run `npm run demo`. Every check then returns one of two fixed sample reports, and they are clearly labelled as demo data.

For production, run `npm run build && npm start`.

### Scan your iPhone screen

troonooz can check whatever is on your iPhone's screen (social media apps, Safari, messages, anything). Double-tap the back of the phone and a Shortcut screenshots the current app, sends it to troonooz, and opens the result: the verdict, a plain-language **What's going on** explanation, and **Explain more** for the background. iOS doesn't let apps read other apps' screens, so a screenshot is how this works.

1. **Connect the phone to troonooz with [Tailscale](https://tailscale.com)** (free for personal use). Install it on the PC running troonooz and on the iPhone, and sign in to the same account on both. Then run this once on the PC:
   ```
   tailscale serve --bg 8787
   ```
   This shares troonooz over HTTPS with your own Tailscale devices only (not the public internet), keeps sharing in the background, and resumes after a reboot. Serve needs MagicDNS and HTTPS certificates, which are on by default for new tailnets. To stop sharing, run the command `tailscale serve` prints when it starts (for example `tailscale serve --https=443 off`); `tailscale serve status` shows the address. Open the `https://….ts.net` address it shows in Safari on the iPhone.
2. **Open the Phone page** (`#/phone`) on the iPhone. It shows the exact Shortcut settings for your address, with copy buttons. The Shortcut has four actions:
   1. Take Screenshot
   2. Get Contents of URL: `https://<your-pc>.<tailnet>.ts.net/api/scan?mode=quick`, Method POST, Request Body File (the screenshot)
   3. Get Dictionary Value `open_url`
   4. Open URLs
3. **Make it one tap:** Settings → Accessibility → Touch → Back Tap → Double Tap → the Shortcut. On iPhone 15 Pro and later you can use the Action Button instead.
4. Optionally, add troonooz to the Home Screen from Safari (Share → Add to Home Screen).

If the Shortcut opens the wrong address, the Phone page says so and gives the line to add to `.env` (`TROONOOZ_PUBLIC_URL=https://…ts.net`).

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
   • submit_report (JSON schema; validated, with errors sent back for a retry) to finish
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
| `src/analysis/schema.ts` | Report schema (Zod; converted to the `submit_report` tool schema and used to validate it) |
| `src/analysis/analyzer.ts` | The Claude loop: tools, `pause_turn`, refusal/`max_tokens` handling, retries, zoom tool |
| `src/analysis/evidence.ts` | Turns uploads into labelled image blocks and fenced untrusted text |
| `src/analysis/images.ts` | Resizing, tiling, zoom crops (sharp) |
| `src/analysis/metadata.ts` | Provenance and EXIF signals |
| `src/analysis/grounding.ts` | Source-URL ledger and grounding check |
| `src/knowledge/fingerprint.ts` | Image/video/link/text fingerprints and the two-stage image comparison |
| `src/knowledge/base.ts` | SQLite knowledge base: instant matches, entity findings, full-text search, RDAP cache |
| `src/knowledge/findings.ts` | Extracting entities from reports and formatting them for Claude |
| `src/knowledge/triage.ts` | Story triage: the short pre-check that recognises a story already checked |
| `src/server/app.ts` | HTTP API, job runner, SSE |
| `public/` | Web app (vanilla JS, no build step) |
| `extension/` | Chrome MV3 extension |

## Shared knowledge

Every finished report feeds a SQLite database at `data/knowledge.sqlite`. This database is an index built from the JSON reports: delete it, or upgrade to a version with a new database layout, and it is rebuilt from them at the next start. It has three layers.

**1. Instant matches.** Before calling Claude, troonooz fingerprints each item in the submission and looks for an earlier report that covered the same content:

| Item | Fingerprint | Survives | Doesn't survive |
|---|---|---|---|
| Image | 256-bit difference hash to shortlist candidates, then a 320px greyscale thumbnail comparison to confirm | Resizing, recompression, format changes, brightness shifts | Cropping; any changed word, number, or price |
| Video | Hashes of the sampled frames (at least 75% must match) | Re-encoding | Different clips or capture timing |
| Link | Canonical URL (no tracking parameters, `www.`, or fragment) | Tracking codes, http vs https | Different articles |
| Text | SHA-256 of the normalized text (40+ characters; shorter notes are ignored) | Case, punctuation, whitespace | Any wording change |

An earlier report is reused only when **every** fingerprinted item matches and all of the following hold:
- It is recent enough: 24 hours for news, 14 days for sellers, 30 days for media-only checks.
- Nobody has flagged it as wrong.
- It used web research if the new request does.
- It covered the requested focus.

If an item can't be fingerprinted (for example a blank image), no reuse happens. The user sees an **Already checked** card with the earlier result and a **Check again anyway** button, which runs a fresh check without re-uploading. Screenshots of the same post taken on two different phones won't match, because each crops differently; the second layer handles that case.

Why two stages for images: a perceptual hash alone can't tell apart two posts in the same app layout. The text is a sliver of the image and the rest is identical white space, so in testing two different posts were 4 bits apart out of 256. The thumbnail check catches a single changed word or price.

**2. Entity findings.** Each report's conclusions are stored as entities:
- **claims:** verdict, explanation, sources
- **sellers:** keyed by domain
- **accounts and outlets**
- **media:** keyed by fingerprint

Only conclusions are stored, never screenshots or who submitted them, and senders of private messages are not stored as accounts.

New checks use these findings in two ways:
- **Automatically:** findings tied to the same content or seller domain are added to Claude's evidence as dated "Prior troonooz findings".
- **On demand:** Claude gets a `lookup_prior_findings` tool (full-text search) and is told to use it before web searching for the main claims, sellers, and accounts.

Findings are presented as dated leads with agreement counts (for example "seen in 3 checks: contradicted ×3"). Claude is told to re-verify anything stale, thin, disputed, or about a developing story.

**3. Stories.** A story groups every check of the same claim, event, piece of media, or offer. Screenshots of one viral post taken on different phones, or a hoax photo reused with a new caption, end up as one story. Each report shows its story's other checks under **Related checks**.

Stories need reading, not just fingerprints. So when the database holds at least one story, a short **triage** call to Claude (`TROONOOZ_TRIAGE_MODEL`, low effort, images at most 1568px) runs before the full check:
1. Claude describes the material (summary, claims, named entities, search terms) and calls `find_stories`, which searches the story database. If nothing is similar, triage ends after this one call.
2. If there are candidates, Claude sees each one's summary, verdict, and thumbnail, and calls `report_story_match` with a confidence. The submitted images are read from the prompt cache on this turn.
3. With a **high**-confidence match to a story that is fresh, undisputed, used web research if the new request does, and covered the requested focus, the user sees **Already checked: same story** with the latest result and a **Check this one anyway** button.
4. Otherwise, a **high** or **medium** match is passed to the full check as context, and with high confidence the new report joins that story.

Reports also join a story automatically when they share a link, text, image, seller website, or identical claim with one of its reports. Triage is only an optimization: if it fails, the full check runs as usual.

Each triage call has a cost. It pays off only when people often check the same stories, so watch the `triage:` lines in the server log (candidates, verdict, tokens). Turn it off with `TROONOOZ_STORY_TRIAGE=off`; the deterministic story grouping keeps working without it.

**Report a problem.** The button on each report marks it as disputed. A disputed report is never reused for an instant match, and its findings carry a warning when they come up in later checks.

The database also caches domain-registration (RDAP) lookups for 7 days. Turn the whole feature off with `TROONOOZ_KNOWLEDGE=off`.

## Speed

Every report records where its time went: preparing evidence, looking for earlier checks, researching, and writing the report. The breakdown appears under **How this check was done** and in the server log (for example `done in 64.2s (thorough: prepare 1.1s, earlier checks 0.0s, research 41.5s, writing 21.6s; …)`).

Two features make checks faster or feel faster:
- **Quick check** (a choice on the form, and a checkbox in the extension popup): medium effort, at most 3 searches and 1 page read, no zooming, and a shorter report. A quick result is never reused for someone who asks for a thorough check.
- **Early verdict:** the report schema puts the verdict first. While Claude writes the report, the score, verdict, and summary appear as a **Preliminary result**, before the full report is finished. These drafts are streamed live but not kept in the job history.

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
| `TROONOOZ_EFFORT` | `high` | Effort for thorough checks: `low` · `medium` · `high` · `xhigh` · `max` |
| `TROONOOZ_QUICK_EFFORT` | `medium` | Effort for quick checks |
| `TROONOOZ_QUICK_SEARCHES` | `3` | Web searches allowed in a quick check (it also reads at most 1 page and doesn't zoom) |
| `TROONOOZ_FALLBACKS` | `on` | Server-side refusal fallbacks |
| `TROONOOZ_WEB_SEARCH_MAX_USES` | `8` | Searches per check (0 disables) |
| `TROONOOZ_WEB_FETCH_MAX_USES` | `5` | Page fetches per check (0 disables) |
| `TROONOOZ_MAX_ZOOMS` | `6` | `inspect_region` calls per check (0 disables) |
| `TROONOOZ_RDAP` | `on` | Domain-age lookups via rdap.org |
| `TROONOOZ_KNOWLEDGE` | `on` | Shared knowledge: instant matches, earlier findings, and stories |
| `TROONOOZ_STORY_TRIAGE` | `on` | Short pre-check that recognises a story already checked from a different screenshot |
| `TROONOOZ_TRIAGE_MODEL` | `claude-opus-5-5` | Model for story triage (always low effort) |
| `TROONOOZ_MAX_FILES` / `_MAX_FILE_MB` | `20` / `100` | Upload limits |
| `TROONOOZ_MAX_IMAGES` | `40` | Images sent to Claude per check (after tiling and frame sampling) |
| `TROONOOZ_VIDEO_FRAMES` | `8` | Frames sampled per server-processed video |
| `TROONOOZ_MAX_CONCURRENT` | `3` | Concurrent checks (more get HTTP 429) |
| `TROONOOZ_DATA_DIR` | `data` | Where reports are stored |
| `TROONOOZ_PUBLIC_URL` | – | Address put in links for other apps (the iPhone Shortcut). Worked out from each request when unset. |
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
| `mode` | `thorough`/`quick` | Quick: medium effort, at most 3 searches and 1 page read, no zooming, shorter report (default `thorough`) |
| `reuse` | `true`/`false` | Allow an instant match with an earlier report (default `true`) |
| `source` | `web`/`extension`/`api` | Where the request came from |

Other endpoints:

- `GET /api/jobs/:id/events` is a Server-Sent Events stream of `progress` events (`status`, `thinking`, `search`, `fetch`, `lookup`, `zoom`, `writing`, `draft`, `fallback`) that ends with `done`, `match` (an earlier report covers this content), or `error`. Each event has an `id`, so a reconnecting client resumes where it left off. `draft` events (the verdict while the report is written) are live only and carry no `id`. Because `EventSource` can't send headers, this endpoint also accepts the token as `?token=`.
- `GET /api/reports/:id` returns the full record (report, inputs, thumbnails, automated signals, research log, token usage) and its `story` (other checks of the same story). `GET /api/reports` lists recent reports, and `DELETE /api/reports/:id` deletes one.
- `POST /api/scan` is for one-tap clients such as the iPhone Shortcut. The body is a raw screenshot (or a shared link or text as `text/plain`, or the same form as `/api/analyze`). Options go in the query string: `mode` (default `quick`), `focus`, `web`, and `reuse`. It returns the same JSON as `/api/analyze` plus `open_url`, an absolute link to the live report.
- `POST /api/jobs/:id/rerun` runs a fresh check on content from a matched job, without re-uploading it.
- `POST /api/reports/:id/dispute` with `{"note": "..."}` flags a report as possibly wrong.
- `GET /api/health` returns the server status, including knowledge-base counts.

Example:

```bash
curl -F files=@post.png -F 'focus=["news"]' http://localhost:8787/api/analyze
```

## Privacy and security

- Submitted content and screenshots go to the Anthropic API for analysis. With RDAP on, the domain names of submitted links also go to rdap.org.
- Reports, including small thumbnails, are stored as JSON files in `TROONOOZ_DATA_DIR` on your server.
- With shared knowledge on, one user's check can inform another user's result on the same server: instant matches show the earlier report, and findings (claims, sellers, accounts, media verdicts) are reused. The History page also lists every check on the server. Keep that in mind before letting people you don't know use one server.
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
npm test            # vitest: schema, metadata, imaging, fingerprints, knowledge base, grounding, analyzer loop (scripted model), HTTP API, ffmpeg
npm run typecheck
npm run build
```

The analyzer takes a `Streamer` function, so tests and demo mode can substitute a scripted model (`src/analysis/demo.ts`, `test/helpers.ts`). The real implementation wraps `client.beta.messages.stream(...)`.
