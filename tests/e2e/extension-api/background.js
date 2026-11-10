// The test extension's service worker (ADR-053): it uses the chrome.* APIs Electron lacks, and
// reports what it saw by opening pages of its own (`page.html#…`), which the test reads as tab URLs.

const report = (what) => chrome.tabs.create({ url: `page.html#${encodeURIComponent(what)}`, active: false });

chrome.contextMenus.removeAll(() => {
  chrome.contextMenus.create({ id: "api-test", title: "Tester l'API", contexts: ["page", "selection"] });
});
chrome.action.setBadgeBackgroundColor({ color: "#d00000" });
chrome.action.setBadgeText({ text: "7" });

chrome.windows.getAll({ populate: true }).then(async (windows) => {
  // No `tabs` permission and no host permission: tab URLs and titles are hidden.
  const tabs = windows.flatMap((window) => window.tabs);
  const commands = await chrome.commands.getAll();
  const shape = {
    windows: windows.length,
    tabs: tabs.length,
    urls: tabs.filter((tab) => "url" in tab || "title" in tab).length,
    browser: typeof browser.tabs.create,
    commands: commands.map((command) => command.name).join(","),
  };
  await chrome.action.setTitle({ title: JSON.stringify(shape) });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  await chrome.action.setBadgeText({ text: "ok" });
  // activeTab is not declared: still no URL.
  await report(`menu:${info.menuItemId}:${info.pageUrl ? "page" : "none"}:${tab && typeof tab.id === "number" ? "tab" : "notab"}:${tab && "url" in tab ? "url" : "nourl"}`);
});

chrome.action.onClicked.addListener(async (tab) => {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  await report(`action:${tab.id === active?.id ? "same" : "other"}`);
});

