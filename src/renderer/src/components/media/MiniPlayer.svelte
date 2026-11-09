<script lang="ts">
  import { t as tr, t } from "@shared/i18n";
  import { currentPosition, formatMediaTime, type MediaSource } from "@shared/media";
  import { api } from "../../lib/browser.svelte";
  import { media } from "../../lib/media.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import MediaArtwork from "./MediaArtwork.svelte";

  /**
   * "Pause des médias" (ADR-035): the most recent source playing outside the tab on screen, at the
   * bottom of the sidebar; with several, a count opens the list of all of them above the card.
   */
  const sources = $derived(media.shown);
  const top = $derived(sources[0]);
  let expanded = $state(false);
  /** Position picked on the progress bar while dragging (seconds), until the page reports it. */
  let seeking = $state<number | null>(null);

  $effect(() => {
    if (sources.length < 2) expanded = false;
  });

  const position = $derived(top ? (seeking ?? currentPosition(top, media.now)) : 0);
  const playLabel = (source: MediaSource) => (source.playing ? t("miniPlayer.pause") : tr("miniPlayer.play"));

  function seek(source: MediaSource, value: number): void {
    seeking = null;
    api.media.action(source.tabId, { seek: value });
  }
</script>

{#if top}
  <section class="mini-player" aria-label={t("miniPlayer.nowPlaying")} data-testid="mini-player">
    {#if expanded}
      <ul class="list" aria-label={t("miniPlayer.playbackSources")} data-testid="media-list">
        {#each sources as source (source.tabId)}
          <li class="row">
            <button class="row-main" title={t("miniPlayer.goTab")} onclick={() => api.media.focus(source.tabId)}>
              <MediaArtwork src={source.artwork} size="sm" />
              <span class="labels">
                <span class="title">{source.title}</span>
                <span class="subtitle">{source.subtitle}</span>
              </span>
            </button>
            <IconButton
              size="sm"
              icon={source.playing ? "pause" : "play"}
              label={playLabel(source)}
              disabled={!source.controllable}
              onclick={() => api.media.action(source.tabId, "toggle")}
            />
            <IconButton
              size="sm"
              icon={source.muted ? "volume-off" : "volume"}
              label={source.muted ? t("miniPlayer.unmute") : t("miniPlayer.mute")}
              onclick={() => api.media.toggleMute(source.tabId)}
            />
            <IconButton size="sm" icon="close" label={t("miniPlayer.close")} onclick={() => api.media.dismiss(source.tabId)} />
          </li>
        {/each}
      </ul>
    {/if}
    <div class="card">
      <div class="head">
        <button class="head-main" title={t("miniPlayer.goTab")} onclick={() => api.media.focus(top.tabId)}>
          <MediaArtwork src={top.artwork} />
          <span class="labels">
            <span class="title" data-testid="mini-player-title">{top.title}</span>
            <span class="subtitle">{top.subtitle}</span>
          </span>
        </button>
        {#if sources.length > 1}
          <button
            class="count"
            aria-expanded={expanded}
            aria-label={t("miniPlayer.playbackSources2", { sourcesCount: sources.length })}
            title={t("miniPlayer.allSources")}
            onclick={() => (expanded = !expanded)}
          >
            {sources.length}
          </button>
        {/if}
      </div>
      {#if top.duration}
        <input
          class="progress"
          type="range"
          min="0"
          max={top.duration}
          step="1"
          value={position}
          aria-label={t("miniPlayer.playbackPosition")}
          aria-valuetext="{formatMediaTime(position)} sur {formatMediaTime(top.duration)}"
          style:--progress="{(position / top.duration) * 100}%"
          disabled={!top.controllable}
          oninput={(event) => (seeking = Number(event.currentTarget.value))}
          onchange={(event) => seek(top, Number(event.currentTarget.value))}
        />
      {/if}
      <div class="controls">
        <span class="time">{formatMediaTime(position)}{top.duration ? ` / ${formatMediaTime(top.duration)}` : ""}</span>
        <IconButton
          size="sm"
          icon={top.playing ? "pause" : "play"}
          label={playLabel(top)}
          disabled={!top.controllable}
          onclick={() => api.media.action(top.tabId, "toggle")}
        />
        <IconButton size="sm" icon="fast-forward" label={t("miniPlayer.skipAhead10S")} disabled={!top.controllable} onclick={() => api.media.action(top.tabId, "forward")} />
        {#if top.video}
          <IconButton size="sm" icon="pip" label={t("miniPlayer.picturePicture")} onclick={() => api.media.pictureInPicture(top.tabId)} />
        {/if}
        <IconButton size="sm" icon="close" label={t("miniPlayer.closePlayer")} onclick={() => api.media.dismiss(top.tabId)} />
      </div>
    </div>
  </section>
{/if}

<style>
  .mini-player {
    display: flex;
    flex: none;
    flex-direction: column;
    gap: var(--space-1);
    margin-top: var(--space-2);
    animation: enter var(--motion-base) var(--ease);
  }
  @keyframes enter {
    from {
      opacity: 0;
      transform: translateY(var(--space-1));
    }
  }
  .card,
  .list {
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2);
  }
  .list {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: var(--space-1);
    list-style: none;
    animation: enter var(--motion-fast) var(--ease);
  }
  .head,
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
  }
  .head-main,
  .row-main {
    display: flex;
    flex: 1;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    padding: 0;
    border-radius: var(--radius-sm);
    text-align: start;
  }
  .row-main {
    min-height: var(--hit-min);
    padding: 0 var(--space-1);
  }
  .head-main:hover .title,
  .row-main:hover .title {
    text-decoration: underline;
  }
  .labels {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .title,
  .subtitle {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .title {
    color: var(--text);
    font-size: var(--text-sm);
    font-weight: 550;
  }
  .subtitle {
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
  .count {
    display: grid;
    flex: none;
    place-items: center;
    min-width: var(--space-5);
    height: var(--space-5);
    padding: 0 var(--space-1);
    border-radius: var(--radius-pill);
    background: var(--surface-active);
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }
  .count:hover,
  .count[aria-expanded="true"] {
    background: var(--surface-hover);
    color: var(--text);
  }
  .progress {
    width: 100%;
    height: var(--space-1);
    margin: var(--space-1) 0;
    border-radius: var(--radius-pill);
    background: linear-gradient(to right, var(--accent) var(--progress), var(--surface-active) var(--progress));
    cursor: pointer;
    appearance: none;
  }
  .progress::-webkit-slider-thumb {
    width: var(--space-3);
    height: var(--space-3);
    border-radius: 50%;
    background: var(--text);
    opacity: 0;
    transition: opacity var(--motion-fast) var(--ease);
    appearance: none;
  }
  .progress:hover::-webkit-slider-thumb,
  .progress:focus-visible::-webkit-slider-thumb {
    opacity: 1;
  }
  .progress:disabled {
    cursor: default;
  }
  .controls {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .time {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
</style>
