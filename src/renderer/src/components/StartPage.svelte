<script lang="ts">
  import type { HistoryEntry } from "@shared/types";
  import { displayUrl } from "@shared/url";
  import { api, browser } from "../lib/browser.svelte";
  import { commandShortcut, shortcutKeys, commandAccelerator, getCommand, type CommandId } from "@shared/commands";
  import { platform } from "../lib/platform.svelte";
  import { settings } from "../lib/settings.svelte";
  import Favicon from "./Favicon.svelte";
  import Icon from "./Icon.svelte";

  let query = $state("");
  let topSites = $state<HistoryEntry[]>([]);

  // The start page is mounted each time it shows, so this stays fresh without a subscription.
  // A private window does not show them (someone looking at the screen would see your habits).
  $effect(() => {
    if (browser.isPrivate) return;
    api.history.topSites(8).then((sites) => (topSites = sites), () => {});
  });
  let now = $state(new Date());

  $effect(() => {
    const timer = setInterval(() => (now = new Date()), 10_000);
    return () => clearInterval(timer);
  });

  const time = $derived(now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }));
  const greeting = $derived(now.getHours() < 5 || now.getHours() >= 18 ? "Bonsoir" : "Bonjour");
  const options = $derived(settings.current.startPage);
  const name = $derived(options.greetingName.trim());
  const image = $derived(options.background === "image" && options.backgroundImage ? options.backgroundImage : null);
  /**
   * The image itself, as a data: URL fetched by main: the UI loads no remote image (CSP
   * `img-src 'self' data:`, ADR-018). Private windows keep their own look and do not load it.
   */
  let imageData = $state<string | null>(null);
  $effect(() => {
    const url = image;
    imageData = null;
    if (!url || browser.isPrivate) return;
    api.settings.startImage().then(
      (data) => {
        if (image === url) imageData = data;
      },
      () => {},
    );
  });

  /** Shortcut hints, from the command registry (keys as on the keyboard of this platform). */
  const HINTS: { id: CommandId; label: string }[] = [
    { id: "command-palette", label: "palette de commandes" },
    { id: "focus-address", label: "barre d'adresse" },
    { id: "new-tab", label: "nouvel onglet" },
    { id: "toggle-sidebar", label: "barre latérale" },
  ];
  const hints = $derived(
    HINTS.map((hint) => ({ ...hint, keys: shortcutKeys(commandAccelerator(getCommand(hint.id), platform.name) ?? "", platform.name) })).filter(
      (hint) => commandShortcut(hint.id, platform.name),
    ),
  );

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    const id = browser.state.activeTabId;
    if (query.trim() && id) api.tabs.navigate(id, query);
  }

  function openSite(url: string): void {
    const id = browser.state.activeTabId;
    if (id) api.tabs.navigate(id, url);
  }
</script>

<section
  class="start"
  class:aurora={options.background === "aurora"}
  class:image={imageData !== null}
  style:--start-image={imageData ? `url("${imageData}")` : undefined}
>
  {#if browser.isPrivate}
    <span class="mask"><Icon name="mask" size={32} /></span>
    <h1>Navigation privée</h1>
  {:else}
    {#if options.showClock}<p class="time">{time}</p>{/if}
    <h1>{greeting}{#if name}, {name}{/if}.</h1>
  {/if}
  <form class="search" onsubmit={submit}>
    <Icon name="search" size={20} />
    <!-- svelte-ignore a11y_autofocus -->
    <input bind:value={query} placeholder="Rechercher sur le web ou saisir une adresse" spellcheck="false" autofocus />
  </form>
  {#if browser.isPrivate}
    <ul class="private" aria-label="Ce que la navigation privée conserve">
      <li><Icon name="check" size={16} /> Ni historique, ni sites fréquents, ni session restaurée</li>
      <li><Icon name="check" size={16} /> Cookies, cache et données de sites effacés à la fermeture de la fenêtre</li>
      <li><Icon name="check" size={16} /> Autorisations accordées pour cette fenêtre seulement</li>
      <li class="kept"><Icon name="star" size={16} /> Les favoris ajoutés et les fichiers téléchargés sont conservés</li>
    </ul>
  {:else if options.showTopSites && topSites.length}
    <nav class="sites" aria-label="Sites les plus visités">
      {#each topSites as site (site.url)}
        <button class="site" title={site.url} onclick={() => openSite(site.url)}>
          <span class="tile"><Favicon src={site.favicon} /></span>
          <span class="name">{site.title || displayUrl(site.url)}</span>
        </button>
      {/each}
    </nav>
  {/if}
  <ul class="hints" aria-label="Raccourcis clavier">
    {#each hints as hint (hint.id)}
      <li>
        <span class="keys">{#each hint.keys as key, index (index)}<kbd>{key}</kbd>{/each}</span>
        {hint.label}
      </li>
    {/each}
  </ul>
</section>

<style>
  .start {
    position: relative;
    isolation: isolate;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 100%;
    padding: 24px;
    animation: rise 0.4s var(--ease);
  }
  /* Optional backgrounds, behind the content (z-index -1 within the isolated section). */
  .start.aurora::before,
  .start.image::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -1;
  }
  .start.aurora::before {
    background:
      radial-gradient(45% 55% at 20% 25%, color-mix(in oklab, var(--accent) 38%, transparent), transparent 70%),
      radial-gradient(40% 50% at 80% 30%, color-mix(in oklab, var(--accent-2) 32%, transparent), transparent 70%),
      radial-gradient(50% 45% at 55% 90%, color-mix(in oklab, var(--accent) 22%, transparent), transparent 70%);
    filter: blur(20px);
    animation: drift 18s ease-in-out infinite alternate;
  }
  .start.image::before {
    background:
      linear-gradient(color-mix(in oklab, var(--bg-elevated) 35%, transparent), color-mix(in oklab, var(--bg-elevated) 70%, transparent)),
      var(--start-image) center / cover no-repeat;
  }
  .time {
    margin: 0;
    color: var(--text-faint);
    font-size: 14px;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.08em;
  }
  h1 {
    margin: 0 0 22px;
    font-size: clamp(32px, 5vw, 52px);
    font-weight: 600;
    letter-spacing: -0.04em;
    background: linear-gradient(120deg, var(--text) 30%, var(--accent-text) 85%);
    background-clip: text;
    color: transparent;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 12px;
    width: min(620px, 100%);
    height: 52px;
    padding: 0 18px;
    border: 1px solid var(--border);
    border-radius: 16px;
    background: var(--bg-elevated);
    color: var(--text-faint);
    box-shadow: 0 20px 60px -20px color-mix(in oklab, var(--accent) 45%, transparent);
  }
  .search:focus-within {
    border-color: color-mix(in oklab, var(--accent) 60%, transparent);
  }
  .search input {
    flex: 1;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--text);
    font-size: 16px;
    user-select: text;
  }
  /* Few sites stay centered; many wrap onto centered rows. */
  .sites {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 10px;
    width: min(620px, 100%);
    margin-top: 22px;
  }
  .site {
    display: flex;
    width: 88px;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 10px 4px;
    border-radius: 12px;
    color: var(--text-muted);
  }
  .site:hover {
    background: var(--surface-hover);
    color: var(--text);
  }
  .tile {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
  }
  .name {
    width: 100%;
    overflow: hidden;
    font-size: 12px;
    text-align: center;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .mask {
    display: grid;
    place-items: center;
    width: 64px;
    height: 64px;
    margin-bottom: 10px;
    border-radius: 20px;
    background: linear-gradient(140deg, color-mix(in oklab, var(--accent) 40%, transparent), color-mix(in oklab, var(--accent-2) 30%, transparent));
    box-shadow:
      inset 0 0 0 1px color-mix(in oklab, var(--accent) 45%, transparent),
      0 18px 50px -18px var(--accent);
    color: var(--text);
  }
  .private {
    display: grid;
    gap: 9px;
    width: min(620px, 100%);
    margin: 24px 0 0;
    padding: 16px 20px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: color-mix(in oklab, var(--bg-elevated) 70%, transparent);
    color: var(--text-muted);
    font-size: 13px;
    list-style: none;
  }
  .private li {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .private li > :global(svg) {
    flex: none;
    color: var(--accent-text);
  }
  .private li.kept {
    color: var(--text-faint);
  }
  .private li.kept > :global(svg) {
    color: var(--text-faint);
  }
  .hints {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px 18px;
    margin: 22px 0 0;
    padding: 0;
    color: var(--text-faint);
    font-size: 12px;
    list-style: none;
  }
  .hints li {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .keys {
    display: flex;
    gap: 3px;
  }
  kbd {
    min-width: 20px;
    padding: 1px 5px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--surface);
    font: inherit;
    font-size: 11px;
    text-align: center;
  }
  @keyframes drift {
    to {
      transform: scale(1.08) translate(2%, -2%);
    }
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }
</style>
