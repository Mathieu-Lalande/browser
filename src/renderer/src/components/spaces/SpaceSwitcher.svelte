<script lang="ts">
  import { MAX_SPACES } from "@shared/spaces";
  import type { SpaceId } from "@shared/types";
  import { api, browser } from "../../lib/browser.svelte";
  import Icon from "../Icon.svelte";

  /** `onEdit`: open the editor of a space (right-click, or right after creating one). */
  let { onEdit }: { onEdit: (id: SpaceId) => void } = $props();

  const isMac = window.platform === "darwin";

  async function create(): Promise<void> {
    const space = await api.spaces.create().catch(() => null);
    if (space) onEdit(space.id);
  }
</script>

<div class="switcher">
  <div class="spaces" role="tablist" aria-label="Espaces">
    {#each browser.state.spaces as space, index (space.id)}
      {@const active = space.id === browser.state.activeSpaceId}
      <button
        class="space"
        class:active
        role="tab"
        aria-selected={active}
        aria-label={space.name}
        data-icon={space.icon}
        title={index < 9 ? `${space.name} (${isMac ? "⌘⌥" : "Ctrl+Alt+"}${index + 1})` : space.name}
        style:--dot={space.color ?? "var(--accent)"}
        onclick={() => (active ? onEdit(space.id) : api.spaces.switchTo(space.id))}
        oncontextmenu={(event) => (event.preventDefault(), onEdit(space.id))}
      >
        <Icon name={space.icon} size={16} />
      </button>
    {/each}
  </div>
  <button
    class="add"
    aria-label="Nouvel espace"
    title="Nouvel espace"
    disabled={browser.state.spaces.length >= MAX_SPACES}
    onclick={create}
  >
    <Icon name="plus" size={16} />
  </button>
</div>

<style>
  .switcher {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 2px;
    min-width: 0;
  }
  .spaces {
    display: flex;
    flex: 1;
    gap: 2px;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .space,
  .add {
    position: relative;
    display: grid;
    flex: none;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 9px;
    color: var(--text-muted);
    transition:
      background 0.12s var(--ease),
      color 0.12s var(--ease),
      transform 0.12s var(--ease);
  }
  .space:hover,
  .add:hover:not(:disabled) {
    background: var(--surface-hover);
    color: var(--text);
  }
  .space:active {
    transform: scale(0.92);
  }
  .space.active {
    background: color-mix(in oklab, var(--dot) 18%, transparent);
    color: color-mix(in oklab, var(--dot) 70%, var(--text));
  }
  .space.active::after {
    position: absolute;
    bottom: 2px;
    width: 12px;
    height: 3px;
    border-radius: 2px;
    background: var(--dot);
    content: "";
  }
  .add:disabled {
    opacity: 0.35;
  }
</style>
