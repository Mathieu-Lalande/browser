<script lang="ts">
  import { SPEECH_RATES, speechRateLabel } from "@shared/read-aloud";
  import type { ReaderArticle } from "@shared/reader";
  import { intlLocale, t } from "@shared/i18n";
  import { platform } from "../../lib/platform.svelte";
  import { readAloud } from "../../lib/read-aloud.svelte";
  import Icon from "../Icon.svelte";

  /**
   * Read aloud controls of the reader toolbar (ADR-058): play/pause, then, while this article is
   * read, previous/next paragraph and stop; speed and voice (local voices of the article's language).
   */
  let { tabId, article }: { tabId: string; article: ReaderArticle } = $props();

  const mine = $derived(readAloud.tabId === tabId && readAloud.status !== "idle");
  const playing = $derived(mine && readAloud.status === "playing");

  $effect(() => readAloud.prepare(article));

  function playPause(): void {
    if (mine) readAloud.toggle();
    else readAloud.start(tabId, article);
  }
</script>

<div class="group" role="group" aria-label={t("readAloud.controls")} data-testid="read-aloud">
  <button
    type="button"
    class="choice"
    aria-pressed={playing}
    title={platform.tip(playing ? t("readAloud.pause") : mine ? t("readAloud.resume") : t("readAloud.readAloud"), "read-aloud")}
    aria-label={playing ? t("readAloud.pause") : mine ? t("readAloud.resume") : t("readAloud.readAloud")}
    onclick={playPause}
  >
    <Icon name={playing ? "pause" : mine ? "play" : "read-aloud"} size={13} />
    {#if !mine}<span>{t("readAloud.readAloud")}</span>{/if}
  </button>
  {#if mine}
    <button type="button" class="choice" aria-label={t("readAloud.previous")} title={t("readAloud.previous")} onclick={() => readAloud.step(-1)}
      ><Icon name="skip-back" size={13} /></button
    >
    <button type="button" class="choice" aria-label={t("readAloud.next")} title={t("readAloud.next")} onclick={() => readAloud.step(1)}
      ><Icon name="skip-forward" size={13} /></button
    >
    <button type="button" class="choice" aria-label={t("readAloud.stop")} title={t("readAloud.stop")} onclick={() => readAloud.stop()}
      ><Icon name="stop-square" size={12} /></button
    >
  {/if}
  <label class="pick" title={t("readAloud.speed")}>
    <Icon name="gauge" size={13} />
    <select aria-label={t("readAloud.speed")} value={readAloud.rate} onchange={(event) => readAloud.setRate(Number(event.currentTarget.value))}>
      {#each SPEECH_RATES as rate (rate)}
        <option value={rate}>{speechRateLabel(rate, intlLocale())}</option>
      {/each}
    </select>
  </label>
  {#if readAloud.voices.length > 1}
    <select class="voice" aria-label={t("readAloud.voice")} title={t("readAloud.voice")} value={readAloud.voice?.id ?? ""} onchange={(event) => readAloud.setVoice(event.currentTarget.value)}>
      {#each readAloud.voices as voice (voice.id)}
        <option value={voice.id}>{voice.name}</option>
      {/each}
    </select>
  {/if}
</div>
{#if readAloud.noVoice}
  <span class="note" role="status">{t("readAloud.noVoice")}</span>
{/if}

<style>
  /* The reader toolbar's own look (ReaderView), on its colors. */
  .group {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 2px;
    border: 1px solid var(--reader-rule);
    border-radius: var(--radius-md);
    color: var(--reader-muted);
  }
  .choice {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 4px 8px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--reader-text);
    font: inherit;
    transition: background-color var(--motion-fast) ease-out;
  }
  .choice:hover {
    background: color-mix(in srgb, var(--reader-text) 8%, transparent);
  }
  .choice[aria-pressed="true"] {
    background: color-mix(in srgb, var(--reader-link) 18%, transparent);
  }
  .choice:focus-visible {
    outline: 2px solid var(--reader-link);
    outline-offset: 1px;
  }
  .pick {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding-left: var(--space-1);
  }
  select {
    max-width: 160px;
    padding: 2px 4px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--reader-text);
    font: inherit;
  }
  select:focus-visible {
    outline: 2px solid var(--reader-link);
  }
  option {
    background: var(--reader-bg);
    color: var(--reader-text);
  }
  .note {
    color: var(--reader-muted);
  }
</style>
