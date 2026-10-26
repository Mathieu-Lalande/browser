import "./styles.css";

type Tab = {
  id: number;
  title: string;
  url: string;
};

const homeUrl = "about:blank";
let nextTabId = 2;
let activeTabId = 1;
let tabs: Tab[] = [{ id: 1, title: "Nouvel onglet", url: homeUrl }];

const app = document.querySelector<HTMLDivElement>("#app");

function normalizeUrl(value: string): string {
  const input = value.trim();
  if (!input) return homeUrl;
  if (/^[a-z][a-z\d+\-.]*:\/\//i.test(input) || input.startsWith("about:")) {
    return input;
  }
  if (input.includes(" ") || (!input.includes(".") && !input.includes(":"))) {
    return `https://www.google.com/search?q=${encodeURIComponent(input)}`;
  }
  return `https://${input}`;
}

function activeTab(): Tab {
  return tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
}

function navigate(value: string): void {
  const tab = activeTab();
  tab.url = normalizeUrl(value);
  tab.title = tab.url === homeUrl ? "Nouvel onglet" : tab.url.replace(/^https?:\/\//, "");
  render();
}

function createTab(): void {
  const tab: Tab = { id: nextTabId++, title: "Nouvel onglet", url: homeUrl };
  tabs = [...tabs, tab];
  activeTabId = tab.id;
  render();
}

function closeTab(id: number): void {
  if (tabs.length === 1) return;
  const closedIndex = tabs.findIndex((tab) => tab.id === id);
  tabs = tabs.filter((tab) => tab.id !== id);
  if (id === activeTabId) {
    activeTabId = tabs[Math.min(closedIndex, tabs.length - 1)].id;
  }
  render();
}

function render(): void {
  if (!app) return;
  const tab = activeTab();
  const isHome = tab.url === homeUrl;
  const page = isHome
    ? `<section class="welcome">
        <div class="brand-mark">✦</div>
        <p class="eyebrow">BROWSER</p>
        <h1>Votre espace, sur le web.</h1>
        <p class="welcome-copy">Rapide, privé et pensé pour rester simple.</p>
        <div class="shortcut-grid">
          <button data-url="https://example.com">Ouvrir un site</button>
          <button data-url="https://www.google.com">Rechercher sur le web</button>
        </div>
      </section>`
    : `<section class="page-preview">
        <div class="page-icon">↗</div>
        <h2>${escapeHtml(tab.title)}</h2>
        <p>La surface de navigation est prête. Le moteur de rendu sera intégré au prochain sprint.</p>
        <button class="primary" data-url="${escapeAttribute(tab.url)}">Ouvrir cette adresse</button>
      </section>`;

  app.innerHTML = `
    <header class="topbar">
      <div class="window-controls" aria-hidden="true"><span></span><span></span><span></span></div>
      <div class="tabs" role="tablist">
        ${tabs.map((item) => `
          <button class="tab ${item.id === activeTabId ? "active" : ""}" data-tab="${item.id}" role="tab" aria-selected="${item.id === activeTabId}">
            <span class="tab-dot"></span><span class="tab-title">${escapeHtml(item.title)}</span>
            ${tabs.length > 1 ? `<span class="tab-close" data-close="${item.id}" aria-label="Fermer ${escapeAttribute(item.title)}">×</span>` : ""}
          </button>`).join("")}
        <button class="icon-button new-tab" data-action="new-tab" aria-label="Nouvel onglet">+</button>
      </div>
    </header>
    <nav class="toolbar" aria-label="Navigation">
      <button class="icon-button" data-action="back" aria-label="Précédent">‹</button>
      <button class="icon-button muted" data-action="forward" aria-label="Suivant">›</button>
      <button class="icon-button" data-action="reload" aria-label="Actualiser">↻</button>
      <form class="address-form" id="address-form">
        <span class="lock">${isHome ? "✦" : "⌁"}</span>
        <input id="address" value="${escapeAttribute(tab.url === homeUrl ? "" : tab.url)}" placeholder="Rechercher ou saisir une adresse" autocomplete="off" spellcheck="false" />
        <button class="clear-address" type="button" aria-label="Effacer">×</button>
      </form>
      <button class="icon-button" data-action="menu" aria-label="Menu">•••</button>
    </nav>
    <main class="content">${page}</main>`;
  bindEvents();
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] ?? character);
}

const escapeAttribute = escapeHtml;

function bindEvents(): void {
  document.querySelectorAll<HTMLElement>("[data-tab]").forEach((element) => {
    element.addEventListener("click", () => {
      activeTabId = Number(element.dataset.tab);
      render();
    });
  });
  document.querySelectorAll<HTMLElement>("[data-close]").forEach((element) => {
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      closeTab(Number(element.dataset.close));
    });
  });
  document.querySelectorAll<HTMLElement>("[data-url]").forEach((element) => {
    element.addEventListener("click", () => navigate(element.dataset.url ?? homeUrl));
  });
  document.querySelector("[data-action='new-tab']")?.addEventListener("click", createTab);
  document.querySelector("#address-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.querySelector<HTMLInputElement>("#address");
    navigate(input?.value ?? "");
  });
  document.querySelector(".clear-address")?.addEventListener("click", () => {
    const input = document.querySelector<HTMLInputElement>("#address");
    input?.focus();
    if (input) input.value = "";
  });
}

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "l") {
    event.preventDefault();
    const input = document.querySelector<HTMLInputElement>("#address");
    input?.focus();
    input?.select();
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "t") {
    event.preventDefault();
    createTab();
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "w") {
    event.preventDefault();
    closeTab(activeTabId);
  }
});

render();
