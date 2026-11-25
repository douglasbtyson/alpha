/**
 * Pulls the verdict and summary out of the report while Claude is still
 * writing it, from the raw JSON fragments streamed so far. Deliberately not a
 * general JSON parser: it looks for a few known fields, accepts a string that
 * is still being written, and never throws on malformed or partial input.
 */

export interface ReportDraft {
  rating: string | null;
  trust_score: number | null;
  confidence: string | null;
  headline: string;
  summary: string;
}

const ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" };

/** The value of `"key": "..."` after `from`, even if its closing quote hasn't arrived yet. */
function stringField(buf: string, key: string, from = 0, to = buf.length): { value: string; complete: boolean } | null {
  const re = new RegExp(`"${key}"\\s*:\\s*"`, "g");
  re.lastIndex = from;
  const m = re.exec(buf);
  if (!m || m.index >= to) return null;
  let i = m.index + m[0].length;
  let out = "";
  while (i < buf.length) {
    const ch = buf[i]!;
    if (ch === '"') return { value: out, complete: true };
    if (ch === "\\") {
      const next = buf[i + 1];
      if (next === undefined) break;
      if (next === "u") {
        const hex = buf.slice(i + 2, i + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) break;
        out += String.fromCharCode(Number.parseInt(hex, 16));
        i += 6;
        continue;
      }
      out += ESCAPES[next] ?? next;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return { value: out, complete: false };
}

export function extractDraft(buf: string): ReportDraft | null {
  const v = buf.indexOf('"verdict"');
  // The verdict object has no nested objects, so its first closing brace ends it.
  const vEnd = v === -1 ? -1 : buf.indexOf("}", v);
  const scope = v === -1 ? null : { from: v, to: vEnd === -1 ? buf.length : vEnd };

  let rating: string | null = null;
  let confidence: string | null = null;
  let headline = "";
  let trust: number | null = null;
  if (scope) {
    const r = stringField(buf, "rating", scope.from, scope.to);
    if (r?.complete) rating = r.value;
    const c = stringField(buf, "confidence", scope.from, scope.to);
    if (c?.complete) confidence = c.value;
    headline = stringField(buf, "headline", scope.from, scope.to)?.value ?? "";
    // Only a number followed by a delimiter is complete ("8" might still become "85").
    const t = /"trust_score"\s*:\s*(-?\d+(?:\.\d+)?)\s*[,}]/.exec(buf.slice(scope.from, vEnd === -1 ? buf.length : vEnd + 1));
    if (t) trust = Math.max(0, Math.min(100, Math.round(Number(t[1]))));
  }
  const summary = stringField(buf, "summary")?.value ?? "";
  if (rating === null && trust === null && !headline && !summary) return null;
  return { rating, trust_score: trust, confidence, headline, summary };
}
