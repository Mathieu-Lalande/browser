<script lang="ts">
  import { READER_TAGS, type ReaderNode } from "@shared/reader";
  import Self from "./ReaderNodes.svelte";

  /**
   * Draws a validated reader tree (ADR-026) with elements from a fixed list: no HTML string is
   * parsed, no attribute but a link's http(s) `href` and an image's `data:` source is set.
   * Links navigate the tab (or open a new tab with Ctrl/Cmd or the middle button).
   */
  let {
    nodes,
    onlink,
    path = "",
    marks,
  }: {
    nodes: readonly ReaderNode[];
    onlink: (href: string, newTab: boolean) => void;
    /** Path of `nodes` in the tree ("1.0"), and the paths read aloud as one paragraph (ADR-058: `data-speech`). */
    path?: string;
    marks?: ReadonlySet<string>;
  } = $props();
  const keyOf = (index: number) => (path ? `${path}.${index}` : String(index));

  const allowed = new Set<string>(READER_TAGS);

  function follow(event: MouseEvent, href: string | undefined): void {
    event.preventDefault();
    if (!href || (event.type === "auxclick" && event.button !== 1)) return;
    onlink(href, event.type === "auxclick" || event.ctrlKey || event.metaKey);
  }
</script>

{#each nodes as node, index (index)}{#if typeof node === "string"}{node}{:else if node.tag === "img"}{#if node.src?.startsWith("data:image/")}<img
        src={node.src}
        alt={node.alt ?? ""}
      />{/if}{:else if node.tag === "a"}<a href={node.href} onclick={(event) => follow(event, node.href)} onauxclick={(event) => follow(event, node.href)}
      ><Self nodes={node.children} {onlink} path={keyOf(index)} {marks} /></a
    >{:else if node.tag === "br"}<br />{:else if node.tag === "hr"}<hr />{:else if allowed.has(node.tag)}<svelte:element this={node.tag} data-speech={marks?.has(keyOf(index)) ? keyOf(index) : undefined}
      ><Self nodes={node.children} {onlink} path={keyOf(index)} {marks} /></svelte:element
    >{/if}{/each}
