<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon, { type IconName } from "../Icon.svelte";
  import ConfirmButton from "./ConfirmButton.svelte";

  let {
    id,
    icon,
    title,
    description,
    onReset,
    children,
  }: { id: string; icon: IconName; title: string; description: string; onReset?: () => void; children: Snippet } = $props();
</script>

<section class="section" {id} aria-labelledby="{id}-title" data-section={id}>
  <header>
    <span class="badge"><Icon name={icon} size={16} /></span>
    <div class="heading">
      <h2 id="{id}-title">{title}</h2>
      <p>{description}</p>
    </div>
    {#if onReset}
      <ConfirmButton
        question="Réglages par défaut ?"
        confirmLabel="Réinitialiser"
        title="Revenir aux réglages par défaut de cette section"
        onconfirm={onReset}
      >
        <Icon name="reset" size={12} /> Réinitialiser
      </ConfirmButton>
    {/if}
  </header>
  <div class="card">
    {@render children()}
  </div>
</section>

<style>
  .section {
    scroll-margin-top: 24px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 0 4px 12px;
  }
  .badge {
    display: grid;
    flex: none;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: calc(var(--radius) + 2px);
    background: linear-gradient(135deg, color-mix(in oklab, var(--accent) 26%, transparent), color-mix(in oklab, var(--accent-2) 16%, transparent));
    color: var(--accent-text);
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--accent) 25%, transparent);
  }
  .heading {
    flex: 1;
    min-width: 0;
  }
  h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  p {
    margin: 1px 0 0;
    color: var(--text-muted);
    font-size: 12px;
  }
  .card {
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: calc(var(--radius) + 4px);
    background: color-mix(in oklab, var(--bg) 45%, var(--bg-elevated));
  }
</style>
