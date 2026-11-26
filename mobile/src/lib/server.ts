/** Pure helpers for the troonooz server address (no React Native imports, so they are unit-tested). */

/**
 * Turns what someone typed ("desktop-abc.tailnet.ts.net", "https://host/#/phone") into an origin
 * ("https://desktop-abc.tailnet.ts.net"). Returns null for anything that isn't an http(s) address.
 */
export function normalizeServer(input: string | null | undefined): string | null {
  let s = String(input ?? "").trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    // Tailscale (…ts.net) and other full names are https; local addresses (an IP, localhost, a bare
    // computer name, or name.local) are usually plain http.
    const host = s.split(/[/:?#]/)[0]!.toLowerCase();
    const local = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host === "localhost" || !host.includes(".") || host.endsWith(".local");
    s = `${local ? "http" : "https"}://${s}`;
  }
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!url.hostname || url.username || url.password) return null;
  return url.origin;
}

/** A key for storing a server's API token (secure-store keys allow only letters, digits, ".", "-", "_"). */
export function tokenKey(server: string): string {
  return `token.${server.replace(/^https?:\/\//, "").replace(/[^A-Za-z0-9._-]/g, "_")}`;
}

export interface IncomingServer {
  /** What to do with the server named in a link that opened the app. */
  action: "none" | "adopt" | "confirm";
  server: string | null;
}

/**
 * A link such as troonooz://report/abc?server=https://… names the server that ran the check.
 * Adopt it when the app has no server yet; ask before switching away from a different one, since a
 * link from anywhere could otherwise point the app (and the checks you run) at someone else's server.
 */
export function incomingServer(param: string | string[] | undefined, current: string | null): IncomingServer {
  const raw = Array.isArray(param) ? param[0] : param;
  const server = normalizeServer(raw);
  if (!server || server === current) return { action: "none", server };
  return { action: current ? "confirm" : "adopt", server };
}
