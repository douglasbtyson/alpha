import { checkServer, getSettings } from "./lib/settings.js";

const statusEl = document.getElementById("status");
const errorEl = document.getElementById("error");

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = !message;
}

const { serverUrl, token } = await getSettings();

// An error from a previous context-menu action on a page that couldn't show it.
const { lastError } = await chrome.storage.session.get("lastError");
if (lastError) {
  showError(lastError);
  await chrome.storage.session.remove("lastError");
  await chrome.action.setBadgeText({ text: "" });
}

checkServer(serverUrl, token)
  .then((health) => {
    statusEl.textContent = health.demo ? "demo" : "connected";
    statusEl.className = `status ${health.demo ? "warn" : "ok"}`;
    statusEl.title = `${serverUrl} · ${health.model}`;
  })
  .catch((err) => {
    statusEl.textContent = "offline";
    statusEl.className = "status bad";
    showError(`Can't reach the troonooz server at ${serverUrl}: ${err.message}. Start it, or change the address in Settings.`);
  });

// Quick/thorough applies to every action, including right-click checks.
const quick = document.getElementById("quick");
quick.checked = Boolean((await chrome.storage.local.get("quick")).quick);
quick.addEventListener("change", () => chrome.storage.local.set({ quick: quick.checked }));

const chips = [...document.querySelectorAll('input[name="focus"]')];
for (const chip of chips) {
  chip.addEventListener("change", () => {
    const auto = chips.find((c) => c.value === "auto");
    if (chip === auto && chip.checked) chips.forEach((c) => c !== auto && (c.checked = false));
    if (chip !== auto && chip.checked) auto.checked = false;
    if (!chips.some((c) => c.checked)) auto.checked = true;
  });
}

for (const button of document.querySelectorAll("[data-action]")) {
  button.addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return showError("No active tab.");
    const focus = chips.filter((c) => c.checked && c.value !== "auto").map((c) => c.value);
    await chrome.runtime.sendMessage({ type: "run", action: button.dataset.action, tabId: tab.id, focus });
    // Close so the page is usable (area selection needs it).
    window.close();
  });
}

document.getElementById("open-app").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: `${serverUrl}/` });
});
document.getElementById("open-options").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});
