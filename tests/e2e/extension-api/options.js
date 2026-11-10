// The test extension's options page (ADR-053): the same APIs from an extension page (frame preload),
// reported as pages of its own (`page.html#…`).

const report = (what) => chrome.tabs.create({ url: `page.html#${encodeURIComponent(what)}`, active: false });

chrome.contextMenus.create({ id: "api-page", title: "Depuis la page d'options", contexts: ["page"] });
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "api-page") report(`page-menu:${tab && "url" in tab ? "url" : "nourl"}`);
});
chrome.action.onClicked.addListener((tab) => report(`page-action:${tab && "url" in tab ? "url" : "nourl"}`));

(async () => {
  const windows = await chrome.windows.getAll({ populate: true });
  const current = await chrome.tabs.getCurrent();
  await chrome.action.setBadgeBackgroundColor({ color: [0, 128, 0, 255] });
  await chrome.action.setBadgeText({ text: "P" });
  let refused = "no";
  try {
    await chrome.tabs.create({ url: "file:///etc/passwd" });
  } catch {
    refused = "yes";
  }
  await report(`page-ready:${windows.length}:${current ? "tab" : "none"}:${typeof browser.tabs.create}:${refused}`);
})();
