<script lang="ts">
  import type { MiniAction } from "@shared/mini";
  import Icon from "../components/Icon.svelte";
  import Button from "../components/ui/Button.svelte";
  import IconButton from "../components/ui/IconButton.svelte";
  import { miniState } from "./state.svelte";

  /**
   * The bar of a mini window (ADR-048): the site and the page's title (a drag area), then pin on
   * top, copy the link, "Ouvrir dans le navigateur" (Ctrl+O) and close (Ctrl+W).
   */
  const bar = $derived(miniState.current);
  const mac = window.platform === "darwin";
  const key = (letter: string) => (mac ? `⌘${letter}` : `Ctrl+${letter}`);
  let copied = $state(false);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;

  function act(action: MiniAction): void {
    window.browser.mini.act(action);
    if (action !== "copy") return;
    copied = true;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copied = false), 1500);
  }
</script>

<header class="mini-bar" data-testid="mini-bar">
  <div class="site drag" title={bar?.url ?? ""}>
    <span class="lock" class:secure={bar?.secure}><Icon name={bar?.secure ? "lock" : "globe"} size={14} /></span>
    <span class="host">{bar?.host ?? ""}</span>
    <span class="title">{bar?.isLoading ? "Chargement…" : (bar?.title ?? "")}</span>
  </div>
  <div class="actions">
    <IconButton
      icon="pin"
      size="sm"
      label="Toujours au premier plan"
      pressed={bar?.alwaysOnTop ?? false}
      onclick={() => act("pin")}
    />
    <IconButton icon={copied ? "check" : "copy"} size="sm" label={copied ? "Lien copié" : "Copier le lien"} onclick={() => act("copy")} />
    <Button variant="primary" size="sm" icon="open" title={`Ouvrir dans le navigateur (${key("O")})`} onclick={() => act("promote")}>
      Ouvrir dans le navigateur
    </Button>
    <IconButton icon="close" size="sm" label="Fermer" title={`Fermer (${key("W")})`} onclick={() => act("close")} />
  </div>
</header>

<style>
  :global(html.mini),
  :global(html.mini body) {
    height: 100%;
    margin: 0;
  }
  :global(html.mini body) {
    background: var(--bg);
  }
  .mini-bar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: calc(var(--space-6) + var(--space-2));
    padding: 0 var(--space-2) 0 var(--space-3);
    box-sizing: border-box;
  }
  .site {
    display: flex;
    flex: 1;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    align-self: stretch;
  }
  .lock {
    display: grid;
    place-items: center;
    color: var(--text-muted);
  }
  .lock.secure {
    color: var(--accent-text);
  }
  .host {
    flex: none;
    font-weight: 600;
    font-size: var(--text-sm);
  }
  .title {
    overflow: hidden;
    color: var(--text-muted);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .actions {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-1);
  }
</style>
