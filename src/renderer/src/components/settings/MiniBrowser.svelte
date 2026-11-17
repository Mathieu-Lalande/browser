<script lang="ts">
  import type { Settings } from "@shared/settings";
  import { themeVariables, type ResolvedMode } from "@shared/theme";

  /** A miniature browser window drawn with the palette `settings` would produce in `mode`. */
  let { settings, mode }: { settings: Settings; mode: ResolvedMode } = $props();

  const style = $derived(
    Object.entries(themeVariables(settings, mode))
      .filter(([name]) => name.startsWith("--") && !["--font", "--sidebar-width", "--gutter"].includes(name))
      .map(([name, value]) => `${name}: ${value}`)
      .join("; "),
  );
  const right = $derived(settings.layout.sidebarPosition === "right");
</script>

<div class="mini" class:right {style} aria-hidden="true">
  <div class="side">
    <div class="dots"><i></i><i></i><i></i></div>
    <div class="address"></div>
    <div class="tab active"><b></b><span></span></div>
    <div class="tab"><b></b><span></span></div>
    <div class="tab"><b></b><span class="short"></span></div>
  </div>
  <div class="page">
    <div class="hero"></div>
    <div class="line"></div>
    <div class="line short"></div>
    <div class="chips"><i></i><i></i><i></i></div>
  </div>
</div>

<style>
  .mini {
    display: flex;
    gap: var(--space-1);
    width: 100%;
    height: 100%;
    padding: var(--space-1) var(--space-1) var(--space-1) 0;
    background: var(--backdrop);
    color-scheme: inherit;
  }
  .mini.right {
    flex-direction: row-reverse;
    padding: var(--space-1) 0 var(--space-1) var(--space-1);
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    width: 32%;
    padding: 2px 0 0 var(--space-1);
  }
  .right .side {
    padding: 2px var(--space-1) 0 0;
  }
  .dots {
    display: flex;
    gap: var(--space-1);
    margin-bottom: 2px;
  }
  .dots i {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--surface-active);
  }
  .address {
    height: 10px;
    border-radius: calc(var(--radius) * 0.4);
    background: var(--surface-hover);
  }
  .tab {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    height: 11px;
    padding: 0 var(--space-1);
    border-radius: calc(var(--radius) * 0.4);
  }
  .tab.active {
    background: var(--bg-elevated);
    box-shadow: inset 0 0 0 1px var(--border);
  }
  .tab b {
    flex: none;
    width: 5px;
    height: 5px;
    border-radius: 2px;
    background: var(--accent);
  }
  .tab span {
    flex: 1;
    height: 3px;
    border-radius: 2px;
    background: var(--text-faint);
  }
  .tab.active span {
    background: var(--text-muted);
  }
  .tab span.short {
    flex: 0.6 1 auto;
  }
  .page {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2);
    border-radius: calc(var(--page-radius) * 0.5);
    background: var(--bg-elevated);
    box-shadow: var(--viewport-shadow);
  }
  .hero {
    width: 55%;
    height: 9px;
    border-radius: 3px;
    background: linear-gradient(90deg, var(--text) 10%, var(--accent) 60%, var(--accent-2));
  }
  .line {
    height: 4px;
    border-radius: 2px;
    background: var(--text-faint);
    opacity: 0.7;
  }
  .line.short {
    width: 65%;
  }
  .chips {
    display: flex;
    gap: var(--space-1);
    margin-top: auto;
  }
  .chips i {
    width: 16px;
    height: 12px;
    border-radius: 3px;
    background: var(--surface-active);
  }
  .chips i:first-child {
    background: var(--accent);
  }
</style>
