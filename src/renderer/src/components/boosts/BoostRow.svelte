<script lang="ts">
  import { BOOST_FONTS, filtersActive, type Boost } from "@shared/boosts";
  import { api, browser } from "../../lib/browser.svelte";
  import Icon from "../Icon.svelte";
  import Button from "../ui/Button.svelte";
  import ConfirmButton from "../ui/ConfirmButton.svelte";
  import ListRow from "../ui/ListRow.svelte";
  import Toggle from "../ui/Toggle.svelte";

  /** One boost of `browser://boosts`: what it changes, its switch, edit and remove (read only in a private window). */
  let { boost, onedit }: { boost: Boost; onedit: (boost: Boost) => void } = $props();

  const toggle = (enabled: boolean) => api.boosts.save({ ...$state.snapshot(boost), enabled });

  /** A script received from another device runs here only once the user turns it on (ADR-029). */
  function confirmScript(): void {
    const { pending: _pending, ...script } = $state.snapshot(boost).script;
    void api.boosts.save({ ...$state.snapshot(boost), script: { ...script, enabled: true } });
  }

  const summary = $derived.by(() => {
    const parts: string[] = [];
    if (filtersActive(boost.filters)) parts.push("filtres");
    if (boost.font) parts.push(BOOST_FONTS[boost.font].label.toLowerCase());
    if (boost.zaps.length) parts.push(`${boost.zaps.length} élément${boost.zaps.length > 1 ? "s" : ""} masqué${boost.zaps.length > 1 ? "s" : ""}`);
    if (boost.css.trim()) parts.push("CSS");
    if (boost.script.enabled) parts.push("JavaScript");
    return parts.join(" · ") || "Aucune modification";
  });
</script>

<ListRow disabled={!boost.enabled} data-boost-id={boost.id}>
  <span class="icon"><Icon name="rocket" size={16} /></span>
  <span class="kit-text text">
    <span class="title">{boost.name}</span>
    <span class="detail">{boost.match} · {summary}</span>
    {#if boost.script.pending}
      <span class="pending" data-testid="boost-script-pending">
        <Icon name="warning" size={12} /> Script reçu d'un autre appareil — Activer ?
        {#if !browser.isPrivate}
          <Button variant="quiet" size="sm" onclick={confirmScript} aria-label={`Activer le script de ${boost.name}`}>Activer</Button>
        {/if}
      </span>
    {/if}
  </span>
  {#if !browser.isPrivate}
    <Toggle label={`${boost.enabled ? "Désactiver" : "Activer"} ${boost.name}`} checked={boost.enabled} onchange={toggle} />
    <Button variant="quiet" size="sm" onclick={() => onedit(boost)} aria-label={`Modifier ${boost.name}`}><Icon name="pencil" size={12} /> Modifier</Button>
    <ConfirmButton question="Supprimer ce boost ?" confirmLabel="Supprimer" title={`Supprimer ${boost.name}`} onconfirm={() => api.boosts.remove(boost.id)}>
      <Icon name="trash" size={12} />
    </ConfirmButton>
  {/if}
</ListRow>

<style>
  :global(.row.disabled) .title,
  :global(.row.disabled) .icon {
    opacity: 0.55;
  }
  .icon {
    display: grid;
    flex: none;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text-muted);
  }
  .text {
    gap: 2px;
  }
  .title {
    font-weight: 600;
  }
  .detail {
    overflow: hidden;
    color: var(--text-muted);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pending {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text);
    font-size: var(--text-xs);
  }
</style>
