<script lang="ts">
  import { WIDGET_CATALOG, WIDGET_KINDS, canAdd, type StartWidget, type WidgetKind } from "@shared/start-widgets";
  import Icon from "../Icon.svelte";
  import IconButton from "../ui/IconButton.svelte";

  /** "Ajouter un widget": the catalog, as a sheet over the start page. */
  let { widgets, isPrivate, onadd, onclose }: { widgets: StartWidget[]; isPrivate: boolean; onadd: (kind: WidgetKind) => void; onclose: () => void } = $props();

  let sheet = $state<HTMLElement>();
  $effect(() => sheet?.querySelector<HTMLElement>("button:not(:disabled)")?.focus());

  const kinds = $derived(WIDGET_KINDS.filter((kind) => !(isPrivate && WIDGET_CATALOG[kind].revealsHabits)));

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    onclose();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" onclick={onclose}></div>
<div class="sheet" role="dialog" aria-modal="true" aria-label="Ajouter un widget" tabindex="-1" bind:this={sheet} onkeydown={onKeydown}>
  <header>
    <h2>Ajouter un widget</h2>
    <IconButton icon="close" label="Fermer" onclick={onclose} />
  </header>
  <ul>
    {#each kinds as kind (kind)}
      {@const info = WIDGET_CATALOG[kind]}
      {@const allowed = canAdd(widgets, kind)}
      <li>
        <button disabled={!allowed} onclick={() => onadd(kind)}>
          <span class="icon"><Icon name={info.icon} size={20} /></span>
          <span class="text">
            <strong>{info.label}{#if info.network}<em class="badge">Réseau</em>{/if}</strong>
            <span>{allowed ? info.description : "Déjà sur la page."}</span>
          </span>
        </button>
      </li>
    {/each}
  </ul>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 20;
    background: color-mix(in oklab, var(--bg) 40%, transparent);
    animation: fade var(--motion-fast) var(--ease);
  }
  .sheet {
    position: fixed;
    top: 50%;
    left: 50%;
    z-index: 21;
    display: flex;
    flex-direction: column;
    width: min(560px, calc(100% - 32px));
    max-height: calc(100% - 48px);
    padding: 16px;
    border: 1px solid var(--border);
    border-radius: 18px;
    background: var(--bg-elevated);
    box-shadow: 0 30px 80px -20px rgb(0 0 0 / 0.5);
    transform: translate(-50%, -50%);
    animation: rise var(--motion-base) var(--ease);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }
  h2 {
    margin: 0;
    font-size: 16px;
  }
  ul {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 6px;
    margin: 0;
    padding: 0;
    overflow: auto;
    list-style: none;
  }
  button {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    width: 100%;
    height: 100%;
    padding: 10px;
    border-radius: 12px;
    color: var(--text);
    text-align: left;
  }
  button:hover:not(:disabled) {
    background: var(--surface-hover);
  }
  button:disabled {
    opacity: 0.45;
  }
  .icon {
    display: grid;
    flex: none;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: color-mix(in oklab, var(--accent) 16%, transparent);
    color: var(--accent-text);
  }
  .text {
    display: grid;
    gap: 2px;
    font-size: 12px;
  }
  .text span {
    color: var(--text-muted);
  }
  strong {
    font-size: 13px;
  }
  .badge {
    margin-left: 6px;
    padding: 1px 6px;
    border-radius: 6px;
    background: var(--surface);
    color: var(--text-muted);
    font-size: 10px;
    font-style: normal;
    font-weight: 500;
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translate(-50%, calc(-50% + 8px));
    }
  }
</style>
