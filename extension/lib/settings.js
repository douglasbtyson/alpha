export const DEFAULT_SERVER = "http://localhost:8787";

export async function getSettings() {
  const { serverUrl, token } = await chrome.storage.local.get(["serverUrl", "token"]);
  return { serverUrl: normalizeServer(serverUrl || DEFAULT_SERVER), token: token || "" };
}

export async function saveSettings({ serverUrl, token }) {
  await chrome.storage.local.set({ serverUrl: normalizeServer(serverUrl), token: token ?? "" });
}

export function normalizeServer(url) {
  const u = new URL(url.trim());
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Server URL must start with http:// or https://");
  return u.origin;
}

export function isLocal(serverUrl) {
  const host = new URL(serverUrl).hostname;
  return host === "localhost" || host === "127.0.0.1";
}

export async function checkServer(serverUrl, token) {
  const res = await fetch(`${serverUrl}/api/health`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Server responded with HTTP ${res.status}`);
  const body = await res.json();
  if (body.app !== "troonooz") throw new Error("That address is not a troonooz server");
  return body;
}
