<script lang="ts">
  import { t } from "@shared/i18n";
  import { api, browser } from "../../lib/browser.svelte";
  import { readAloud } from "../../lib/read-aloud.svelte";
  import Icon from "../Icon.svelte";
  import IconButton from "../ui/IconButton.svelte";

  /**
   * Read aloud goes on in another tab (ADR-058): a small card at the bottom of the sidebar, shown
   * while an article is read and its reader is not on screen.
   */
  const shown = $derived(readAloud.status !== "idle" && !(browser.activeTab?.id === readAloud.tabId && browser.activeTab?.reader));
  const playing = $derived(readAloud.status === "playing");
</script>

{#if shown}
  <section class="read-aloud" aria-label={t("readAloud.nowReading", { title: readAloud.title })} data-testid="read-aloud-mini">
    <button type="button" class="main" title={t("readAloud.showTab")} onclick={() => readAloud.tabId && api.tabs.activate(readAloud.tabId)}>
      <Icon name="read-aloud" size={14} />
      <span class="title">{readAloud.title}</span>
    </button>
    <IconButton size="sm" icon="skip-back" label={t("readAloud.previous")} onclick={() => readAloud.step(-1)} />
    <IconButton size="sm" icon={playing ? "pause" : "play"} label={playing ? t("readAloud.pause") : t("readAloud.resume")} onclick={() => readAloud.toggle()} />
    <IconButton size="sm" icon="skip-forward" label={t("readAloud.next")} onclick={() => readAloud.step(1)} />
    <IconButton size="sm" icon="stop-square" label={t("readAloud.stop")} onclick={() => readAloud.stop()} />
  </section>
{/if}

<style>
  .read-aloud {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-1);
    margin-top: var(--space-2);
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    animation: enter var(--motion-fast) var(--ease);
  }
  @keyframes enter {
    from {
      opacity: 0;
    }
  }
  .main {
    display: flex;
    flex: 1;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: var(--text-sm);
    text-align: start;
  }
  .title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .main:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: var(--radius-sm);
  }
</style>
