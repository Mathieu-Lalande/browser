<script lang="ts">
  import type { PermissionKind, PermissionPrompt, TabId } from "@shared/types";
  import { api, browser } from "../lib/browser.svelte";
  import Checkbox from "./Checkbox.svelte";
  import Icon from "./Icon.svelte";

  let { tabId, prompt }: { tabId: TabId; prompt: PermissionPrompt } = $props();

  const LABELS: Record<PermissionKind, string> = {
    camera: "utiliser votre caméra",
    microphone: "utiliser votre micro",
    geolocation: "connaître votre position",
    notifications: "vous envoyer des notifications",
    midi: "accéder à vos appareils MIDI",
    "midi-sysex": "contrôler entièrement vos appareils MIDI",
    "clipboard-read": "lire votre presse-papiers",
    "display-capture": "capturer votre écran",
    "idle-detection": "savoir quand vous êtes inactif",
    "window-management": "gérer les fenêtres sur vos écrans",
    "storage-access": "utiliser ses cookies sur d'autres sites",
    "local-fonts": "lister les polices installées",
  };

  let remember = $state(false);
  // A new prompt starts with "remember" unchecked.
  $effect.pre(() => {
    void prompt.id;
    remember = false;
  });

  const hostOf = (origin: string) => {
    try {
      return new URL(origin).host;
    } catch {
      return origin;
    }
  };
  const host = $derived(hostOf(prompt.origin));
  /** The site embedding the asking frame, when it is another one: the decision only holds there. */
  const embedder = $derived(prompt.topOrigin ? hostOf(prompt.topOrigin) : null);
  const request = $derived(new Intl.ListFormat("fr", { type: "conjunction" }).format(prompt.kinds.map((kind) => LABELS[kind])));

  function answer(allow: boolean): void {
    api.permissions.respond(tabId, prompt.id, allow, remember);
  }
</script>

<div class="permission-bar" role="alertdialog" aria-label="Demande d'autorisation">
  <Icon name="shield" size={16} />
  <p><strong>{host}</strong>{#if embedder}&nbsp;<span class="embedder">(intégré dans {embedder})</span>{/if} souhaite {request}.</p>
  <!-- Private window: decisions last as long as the window, nothing is remembered (ADR-014). -->
  {#if !browser.isPrivate}
    <span class="remember"><Checkbox checked={remember} onchange={(value) => (remember = value)}>Se souvenir pour ce site</Checkbox></span>
  {/if}
  <button class="secondary" onclick={() => answer(false)}>Bloquer</button>
  <button class="primary" onclick={() => answer(true)}>Autoriser</button>
</div>

<style>
  .permission-bar {
    display: flex;
    flex: none;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    padding: 6px 8px 6px 14px;
    border-radius: var(--radius);
    background: var(--bg-elevated);
    box-shadow: 0 0 0 1px color-mix(in oklab, var(--accent) 35%, transparent);
    color: var(--accent-text);
    animation: drop 0.18s var(--ease);
  }
  p {
    flex: 1;
    min-width: 200px;
    margin: 0;
    color: var(--text);
  }
  .embedder {
    color: var(--text-muted);
  }
  .remember {
    color: var(--text-muted);
    font-size: 12px;
  }
  button {
    height: 30px;
    padding: 0 14px;
    border-radius: 8px;
    font-weight: 500;
  }
  .secondary {
    background: var(--surface);
  }
  .secondary:hover {
    background: var(--surface-hover);
  }
  .primary {
    background: var(--accent);
    color: var(--on-accent);
  }
  .primary:hover {
    background: color-mix(in oklab, var(--accent) 85%, #fff);
  }
  @keyframes drop {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
  }
</style>
