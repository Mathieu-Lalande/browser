<script lang="ts">
  import type { Suggestion } from "@shared/omnibox/types";
  import Favicon from "../../components/Favicon.svelte";
  import Icon from "../../components/Icon.svelte";
  import Highlight from "../Highlight.svelte";
  import { iconOf } from "./icons";

  /** One result: icon, highlighted title and detail, then its shortcut or (selected) its verb. */
  let {
    item,
    position,
    selected,
    onpointer,
    onpick,
  }: { item: Suggestion; position: number; selected: boolean; onpointer: (event: MouseEvent) => void; onpick: (event: MouseEvent) => void } = $props();

  const answer = $derived(item.section === "answer");
  const site = $derived(item.favicon !== undefined && item.action.type !== "command");
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="row"
  class:answer
  id="omnibox-item-{position}"
  role="option"
  tabindex="-1"
  aria-selected={selected}
  class:selected
  onmousemove={onpointer}
  onmousedown={(event) => event.preventDefault()}
  onclick={onpick}
>
  <span class="icon" class:tile={!site}>
    {#if item.action.type === "command"}
      <Icon name={item.action.command.icon} size={16} />
    {:else if site}
      <Favicon src={item.favicon ?? null} />
    {:else}
      <Icon name={iconOf(item.icon)} size={answer ? 18 : 16} />
    {/if}
  </span>
  <span class="text">
    {#if answer}
      <span class="detail">{item.detail}</span>
      <span class="title">{item.title}</span>
    {:else}
      <span class="title"><Highlight text={item.title} ranges={item.titleRanges} /></span>
      {#if item.detail}
        <span class="detail"><Highlight text={item.detail} ranges={item.detailRanges} /></span>
      {/if}
    {/if}
  </span>
  {#if item.section === "bookmarks"}
    <span class="badge" title="Favori"><Icon name="star" size={12} filled /></span>
  {/if}
  {#if item.shortcut?.length}
    <span class="keys" aria-label="Raccourci">
      {#each item.shortcut as key, index (index)}<kbd>{key}</kbd>{/each}
    </span>
  {:else if selected}
    <span class="hint">{item.verb} <Icon name="enter" size={12} /></span>
  {/if}
</div>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 44px;
    padding: 6px 10px;
    border-radius: 10px;
    color: var(--text-muted);
    scroll-margin: 6px;
  }
  .row.selected {
    background: color-mix(in oklab, var(--accent) 16%, transparent);
    color: var(--text);
  }
  .icon {
    display: grid;
    flex: none;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 8px;
  }
  .icon.tile {
    background: var(--surface);
    box-shadow: inset 0 0 0 1px var(--border);
    color: var(--text-muted);
  }
  .row.selected .icon.tile {
    background: color-mix(in oklab, var(--accent) 22%, transparent);
    color: var(--accent-text);
  }
  .text {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    white-space: nowrap;
  }
  .title,
  .detail {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .title {
    color: var(--text);
    font-size: 13.5px;
  }
  .detail {
    color: var(--text-faint);
    font-size: 11.5px;
  }

  /* Instant answer: the result is the content, set large. */
  .answer {
    min-height: 64px;
    padding: 10px 12px;
  }
  .answer .icon {
    width: 36px;
    height: 36px;
    border-radius: 10px;
  }
  .answer .title {
    font-size: 22px;
    font-weight: 600;
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
  }

  .badge {
    display: grid;
    color: var(--accent-text);
  }
  .keys {
    display: flex;
    flex: none;
    gap: 3px;
  }
  .hint {
    display: flex;
    flex: none;
    align-items: center;
    gap: 6px;
    color: var(--text-faint);
    font-size: 11.5px;
  }
  kbd {
    display: inline-grid;
    place-items: center;
    min-width: 20px;
    height: 20px;
    padding: 0 5px;
    border: 1px solid var(--border);
    border-bottom-width: 2px;
    border-radius: 5px;
    background: var(--surface);
    color: var(--text-muted);
    font: 500 11px/1 var(--font);
  }
  @media (max-width: 520px) {
    .hint {
      display: none;
    }
  }
</style>
