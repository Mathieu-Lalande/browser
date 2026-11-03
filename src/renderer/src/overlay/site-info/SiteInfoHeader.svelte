<script lang="ts">
  import { api } from "../../lib/browser.svelte";
  import Icon from "../../components/Icon.svelte";

  /** The site info popover's header: the host, whether the connection is secure, and "Copier le lien". */
  let { host, secure }: { host: string; secure: boolean } = $props();

  let copied = $state(false);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;

  function copyLink(): void {
    api.commands.run("copy-url");
    copied = true;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copied = false), 1600);
  }
</script>

<header>
  <span class="badge" class:warn={!secure}><Icon name={secure ? "lock" : "warning"} size={16} /></span>
  <div class="heading">
    <h2>{host}</h2>
    <p class:warn-text={!secure}>{secure ? "Connexion sécurisée" : "Connexion non sécurisée"}</p>
  </div>
  <button class="copy" class:done={copied} onclick={copyLink} aria-label={copied ? "Lien copié" : "Copier le lien"} title={copied ? "Lien copié" : "Copier le lien"}>
    {#key copied}<span class="glyph"><Icon name={copied ? "check" : "link"} size={14} /></span>{/key}
    <span>{copied ? "Lien copié" : "Copier le lien"}</span>
  </button>
</header>

<style>
  header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 10px 10px 14px;
    border-bottom: 1px solid var(--border);
  }
  .badge {
    display: grid;
    flex: none;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 10px;
    background: color-mix(in oklab, var(--accent) 14%, transparent);
    color: var(--accent-text);
  }
  .badge.warn {
    background: var(--surface-active);
    color: var(--text);
  }
  .heading {
    flex: 1;
    min-width: 0;
  }
  h2 {
    margin: 0;
    overflow: hidden;
    font-size: 13.5px;
    font-weight: 600;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  p {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
  .warn-text {
    color: var(--text);
  }
  .copy {
    display: flex;
    flex: none;
    align-items: center;
    gap: 5px;
    height: 26px;
    padding: 0 8px;
    border-radius: 7px;
    color: var(--accent-text);
    font-size: var(--text-xs);
    font-weight: 500;
  }
  .copy:hover {
    background: var(--surface-hover);
  }
  .glyph {
    display: grid;
  }
  .copy.done .glyph {
    animation: check-pop var(--motion-base) var(--ease);
  }
  @keyframes check-pop {
    from {
      opacity: 0;
      transform: scale(0.4) rotate(-20deg);
    }
    60% {
      transform: scale(1.2);
    }
  }
</style>
