import { getDomain } from "tldts";

export interface DomainInfo {
  domain: string;
  registered: string | null;
  ageDays: number | null;
  registrar: string | null;
  error: string | null;
}

/**
 * Large platforms where domain age says nothing about the content: the
 * account or seller on the platform is what matters.
 */
const PLATFORM_DOMAINS = new Set([
  "facebook.com", "fb.com", "instagram.com", "threads.net", "threads.com", "x.com", "twitter.com",
  "tiktok.com", "youtube.com", "youtu.be", "reddit.com", "linkedin.com", "pinterest.com",
  "snapchat.com", "whatsapp.com", "telegram.org", "t.me", "bsky.app", "mastodon.social",
  "google.com", "bing.com", "amazon.com", "ebay.com", "etsy.com", "walmart.com", "aliexpress.com",
  "temu.com", "shein.com", "craigslist.org", "wikipedia.org", "medium.com", "substack.com",
  "apple.com", "microsoft.com", "github.com", "imgur.com", "tumblr.com", "quora.com",
]);

/** Registrable domains worth an RDAP lookup, platforms excluded. */
export function candidateDomains(urls: string[], limit = 3): string[] {
  const out: string[] = [];
  for (const u of urls) {
    let host: string;
    try {
      host = new URL(u).hostname;
    } catch {
      continue;
    }
    const d = getDomain(host);
    if (!d || PLATFORM_DOMAINS.has(d) || out.includes(d)) continue;
    out.push(d);
    if (out.length >= limit) break;
  }
  return out;
}

interface RdapEvent {
  eventAction?: string;
  eventDate?: string;
}
interface RdapEntity {
  roles?: string[];
  vcardArray?: [string, Array<[string, unknown, string, unknown]>];
}

export async function lookupDomain(domain: string, fetchImpl: typeof fetch = fetch): Promise<DomainInfo> {
  try {
    const res = await fetchImpl(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
      headers: { accept: "application/rdap+json, application/json" },
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return { domain, registered: null, ageDays: null, registrar: null, error: `RDAP lookup returned HTTP ${res.status}` };
    }
    const json = (await res.json()) as { events?: RdapEvent[]; entities?: RdapEntity[] };
    const reg = json.events?.find((e) => e.eventAction === "registration")?.eventDate ?? null;
    const regDate = reg ? new Date(reg) : null;
    const ageDays =
      regDate && !Number.isNaN(regDate.getTime()) ? Math.floor((Date.now() - regDate.getTime()) / 86_400_000) : null;
    const registrarEntity = json.entities?.find((e) => e.roles?.includes("registrar"));
    const fn = registrarEntity?.vcardArray?.[1]?.find((f) => f[0] === "fn")?.[3];
    return {
      domain,
      registered: regDate && ageDays !== null ? regDate.toISOString().slice(0, 10) : null,
      ageDays,
      registrar: typeof fn === "string" ? fn : null,
      error: null,
    };
  } catch (err) {
    return { domain, registered: null, ageDays: null, registrar: null, error: `RDAP lookup failed: ${(err as Error).message}` };
  }
}

export function describeDomain(d: DomainInfo): string {
  if (d.error) return `${d.domain}: registration data unavailable (${d.error})`;
  if (d.ageDays === null) return `${d.domain}: registration date not published`;
  const years = d.ageDays / 365.25;
  const age = d.ageDays < 365 ? `${d.ageDays} days` : `${years.toFixed(1)} years`;
  return `${d.domain}: registered ${d.registered} (${age} ago)${d.registrar ? `, registrar ${d.registrar}` : ""}`;
}
