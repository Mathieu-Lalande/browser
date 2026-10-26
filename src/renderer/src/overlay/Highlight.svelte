<script lang="ts">
  import { highlightSegments, type Range } from "@shared/fuzzy";

  let { text, ranges }: { text: string; ranges: readonly Range[] } = $props();

  const segments = $derived(highlightSegments(text, ranges));
</script>

{#each segments as segment, index (index)}{#if segment.match}<mark>{segment.text}</mark>{:else}{segment.text}{/if}{/each}

<style>
  mark {
    background: none;
    color: color-mix(in oklab, var(--accent) 65%, var(--text));
    font-weight: 650;
  }
</style>
