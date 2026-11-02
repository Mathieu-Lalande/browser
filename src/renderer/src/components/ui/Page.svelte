<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon, { type IconName } from "../Icon.svelte";

  /**
   * The frame of an internal page (`browser://downloads`, archive, extensions, passwords, boosts):
   * a scrolling column of comfortable width, with one header (badge, title, subtitle, primary
   * action on the right). The action moves under the title on a narrow page.
   */
  let {
    icon,
    title,
    subtitle,
    testid,
    actions,
    children,
  }: { icon: IconName; title: string; subtitle?: Snippet | string; testid?: string; actions?: Snippet; children: Snippet } = $props();
</script>

<div class="page" data-testid={testid}>
  <div class="inner">
    <header>
      <span class="badge"><Icon name={icon} size={20} /></span>
      <div class="heading">
        <h1>{title}</h1>
        {#if typeof subtitle === "string"}<p>{subtitle}</p>{:else if subtitle}<p>{@render subtitle()}</p>{/if}
      </div>
      {#if actions}<div class="actions">{@render actions()}</div>{/if}
    </header>
    {@render children()}
  </div>
</div>

<style>
  .page {
    container: page / inline-size;
    height: 100%;
    overflow-y: auto;
    scrollbar-gutter: stable;
    animation: rise var(--motion-base) var(--ease);
  }
  .inner {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    max-width: var(--page-max);
    margin: 0 auto;
    padding: var(--space-6) var(--space-6) 64px;
  }
  header {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: var(--space-3) var(--space-4);
    margin-bottom: var(--space-2);
  }
  .badge {
    display: grid;
    flex: none;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: var(--radius-lg);
    background: linear-gradient(135deg, color-mix(in oklab, var(--accent) 24%, transparent), color-mix(in oklab, var(--accent-2) 14%, transparent));
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--accent) 22%, transparent);
    color: var(--accent-text);
  }
  .heading {
    display: flex;
    flex: 1 1 240px;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    min-height: 40px;
    justify-content: center;
  }
  h1 {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: 650;
    letter-spacing: -0.02em;
    line-height: 1.25;
  }
  p {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-sm);
    line-height: 1.5;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    min-height: 40px;
    margin-left: auto;
  }
  @container page (max-width: 520px) {
    .inner {
      padding: var(--space-5) var(--space-4) 48px;
    }
    .actions {
      min-height: 0;
      margin-left: 56px;
    }
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
  }
</style>
