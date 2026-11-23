import { checkServer, getSettings, isLocal, normalizeServer, saveSettings } from "./lib/settings.js";

const ALL_SITES = { origins: ["https://*/*", "http://*/*"] };
const server = document.getElementById("server");
const token = document.getElementById("token");
const allSites = document.getElementById("all-sites");
const result = document.getElementById("result");

function say(message, ok) {
  result.textContent = message;
  result.className = `result ${ok ? "ok" : "bad"}`;
}

const current = await getSettings();
server.value = current.serverUrl;
token.value = current.token;
allSites.checked = await chrome.permissions.contains(ALL_SITES);

allSites.addEventListener("change", async () => {
  if (allSites.checked) allSites.checked = await chrome.permissions.request(ALL_SITES);
  else await chrome.permissions.remove(ALL_SITES);
});

/** A server other than localhost needs host permission, which must be requested from a click. */
async function ensureAccess(url) {
  if (isLocal(url)) return true;
  const origins = [`${url}/*`];
  if (await chrome.permissions.contains({ origins })) return true;
  return chrome.permissions.request({ origins });
}

document.getElementById("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  let url;
  try {
    url = normalizeServer(server.value);
  } catch (err) {
    return say(err.message, false);
  }
  if (!(await ensureAccess(url))) return say("Permission to contact that server was not granted.", false);
  await saveSettings({ serverUrl: url, token: token.value.trim() });
  server.value = url;
  say("Saved.", true);
});

document.getElementById("test").addEventListener("click", async () => {
  let url;
  try {
    url = normalizeServer(server.value);
  } catch (err) {
    return say(err.message, false);
  }
  if (!(await ensureAccess(url))) return say("Permission to contact that server was not granted.", false);
  say("Testing…", true);
  try {
    const h = await checkServer(url, token.value.trim());
    const mode = h.demo ? "demo mode (sample data)" : h.claude_configured ? `model ${h.model}` : "no Claude API key configured on the server";
    say(`Connected: ${mode}${h.auth_required ? ", token required" : ""}.`, h.claude_configured);
  } catch (err) {
    say(`Could not connect: ${err.message}`, false);
  }
});
