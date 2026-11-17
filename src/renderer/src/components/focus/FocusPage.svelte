<script lang="ts">
  import { formatDate, t } from "@shared/i18n";
  import { FOCUS_MINUTES, focusMinutesLeft, parseFocusSites, type SiteTimeSummary } from "@shared/focus";
  import { api, browser } from "../../lib/browser.svelte";
  import { settings } from "../../lib/settings.svelte";
  import Icon from "../Icon.svelte";
  import Button from "../ui/Button.svelte";
  import Card from "../ui/Card.svelte";
  import ConfirmButton from "../ui/ConfirmButton.svelte";
  import EmptyState from "../ui/EmptyState.svelte";
  import Page from "../ui/Page.svelte";

  /**
   * `browser://focus` (ADR-059): a focus session (held sites, a ring that empties), and the time
   * spent per site this week, counted on this device only.
   */
  let now = $state(Date.now());
  let summary = $state<SiteTimeSummary | null>(null);
  let sitesDraft = $state(settings.current.focus.sites.join("\n"));
  let savedSites = $state(false);

  const focus = $derived(browser.state.focus);
  const running = $derived(!!focus?.until && focus.until > now);
  const left = $derived(focus ? focusMinutesLeft(focus, now) : 0);
  const progress = $derived(running && focus?.until && focus.startedAt ? (focus.until - now) / (focus.until - focus.startedAt) : 0);
  const RING = 2 * Math.PI * 70;

  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(timer);
  });
  $effect(() => {
    if (browser.isPrivate) return;
    void api.wellbeing.siteTime(7).then((next) => (summary = next));
  });

  const maxDay = $derived(Math.max(1, ...(summary?.days.map((day) => day.ms) ?? [1])));
  const maxSite = $derived(Math.max(1, summary?.sites[0]?.ms ?? 1));
  const duration = (ms: number) => {
    const minutes = Math.round(ms / 60_000);
    return minutes < 60 ? t("focusPage.minutes", { minutes }) : t("focusPage.hours", { hours: Math.floor(minutes / 60), minutes: String(minutes % 60).padStart(2, "0") });
  };
  const clock = $derived.by(() => {
    if (!running || !focus?.until) return "";
    const seconds = Math.max(0, Math.round((focus.until - now) / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  });

  function saveSites(): void {
    settings.update({ focus: { sites: parseFocusSites(sitesDraft) } });
    sitesDraft = parseFocusSites(sitesDraft).join("\n");
    savedSites = true;
    setTimeout(() => (savedSites = false), 1600);
  }
</script>

<Page icon="hourglass" title={t("focusPage.title")} subtitle={t("focusPage.subtitle")} testid="focus-page">
  <section class="hero" class:running>
    <div class="ring" aria-hidden="true">
      <svg viewBox="0 0 160 160" width="160" height="160">
        <defs>
          <linearGradient id="focus-ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="var(--accent)" />
            <stop offset="1" stop-color="var(--accent-2)" />
          </linearGradient>
        </defs>
        <circle class="track" cx="80" cy="80" r="70" />
        <circle class="value" cx="80" cy="80" r="70" stroke-dasharray={RING} stroke-dashoffset={RING * (1 - progress)} />
      </svg>
      <span class="clock">{#if running}{clock}{:else}<Icon name="hourglass" size={32} />{/if}</span>
    </div>
    <div class="hero-text">
      {#if running}
        <h2 role="status">{t("focusPage.running", { left })}</h2>
        <p>{t("focusPage.heldSites", { count: settings.current.focus.sites.length })}</p>
        <div class="buttons">
          <Button variant="secondary" icon="stop-square" onclick={() => api.wellbeing.startFocus(null)}>{t("focusPage.stop")}</Button>
        </div>
      {:else}
        <h2>{t("focusPage.ready")}</h2>
        <p>{t("focusPage.readyHint")}</p>
        <div class="buttons">
          {#each FOCUS_MINUTES as minutes (minutes)}
            <button type="button" class="length" class:main={minutes === settings.current.focus.minutes} onclick={() => api.wellbeing.startFocus(minutes)}>
              <strong>{minutes}</strong><small>min</small>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </section>

  <section class="ui-section">
    <h2 class="ui-section-title"><Icon name="ban" size={14} /> {t("focusPage.blockedSites")}</h2>
    <Card as="div" variant="section" class="sites">
      <textarea class="ui-field" bind:value={sitesDraft} rows="5" spellcheck="false" aria-label={t("focusPage.blockedSites")}></textarea>
      <div class="sites-actions">
        <span class="hint">{t("focusPage.blockedSitesHint")}</span>
        <Button size="sm" variant="primary" icon={savedSites ? "check" : "save"} onclick={saveSites}>{savedSites ? t("focusPage.saved") : t("focusPage.save")}</Button>
      </div>
    </Card>
  </section>

  <section class="ui-section">
    <h2 class="ui-section-title"><Icon name="activity" size={14} /> {t("focusPage.timeThisWeek")}</h2>
    {#if browser.isPrivate}
      <p class="hint">{t("focusPage.privateNoStats")}</p>
    {:else if summary && summary.totalMs > 0}
      <Card as="div" variant="section" class="stats">
        <div class="total"><strong>{duration(summary.totalMs)}</strong> <span class="hint">{t("focusPage.onTheWeb")}</span></div>
        <div class="bars" role="img" aria-label={t("focusPage.perDay")}>
          {#each summary.days as day (day.day)}
            <div class="bar-col" title={`${formatDate(new Date(`${day.day}T12:00`), { weekday: "long" })} · ${duration(day.ms)}`}>
              <span class="bar" style:height="{Math.max(4, (day.ms / maxDay) * 100)}%"></span>
              <small>{formatDate(new Date(`${day.day}T12:00`), { weekday: "narrow" })}</small>
            </div>
          {/each}
        </div>
        <ol class="sites-time">
          {#each summary.sites as entry, index (entry.site)}
            <li style:--hue={(index * 47) % 360}>
              <span class="site">{entry.site}</span>
              <span class="meter"><span style:width="{(entry.ms / maxSite) * 100}%"></span></span>
              <span class="time">{duration(entry.ms)}</span>
            </li>
          {/each}
        </ol>
        <div class="sites-actions">
          <span class="hint">{t("focusPage.localOnly")}</span>
          <ConfirmButton variant="outlined" question={t("focusPage.clearQuestion")} confirmLabel={t("focusPage.clear")} onconfirm={() => (api.wellbeing.clearSiteTime(), (summary = { sites: [], days: [], totalMs: 0 }))}>
            <Icon name="eraser" size={14} /> {t("focusPage.clear")}
          </ConfirmButton>
        </div>
      </Card>
    {:else}
      <EmptyState icon="activity" title={t("focusPage.noTimeYet")} hint={t("focusPage.localOnly")} />
    {/if}
  </section>
</Page>

<style>
  .hero {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-5);
    padding: var(--space-5);
    border: 1px solid color-mix(in oklab, var(--accent) 30%, var(--border));
    border-radius: var(--radius-lg);
    background:
      radial-gradient(90% 120% at 0% 0%, color-mix(in oklab, var(--accent) min(calc(22% * var(--tint, 1)), 90%), transparent), transparent 60%),
      radial-gradient(80% 120% at 100% 100%, color-mix(in oklab, var(--accent-2) min(calc(18% * var(--tint, 1)), 90%), transparent), transparent 60%),
      var(--bg-elevated);
  }
  .ring {
    position: relative;
    display: grid;
    flex: none;
    place-items: center;
    width: 160px;
    height: 160px;
  }
  .ring svg {
    transform: rotate(-90deg);
  }
  .track,
  .value {
    fill: none;
    stroke-width: 12;
  }
  .track {
    stroke: color-mix(in oklab, var(--accent) min(calc(14% * var(--tint, 1)), 90%), transparent);
  }
  .value {
    stroke: url(#focus-ring);
    stroke-linecap: round;
    transition: stroke-dashoffset 1s linear;
  }
  .clock {
    position: absolute;
    color: var(--text);
    font-size: 30px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.02em;
  }
  .hero:not(.running) .clock {
    color: var(--accent-text);
  }
  .hero-text {
    display: flex;
    flex: 1 1 260px;
    flex-direction: column;
    gap: var(--space-2);
  }
  .hero-text h2 {
    margin: 0;
    font-size: var(--text-xl);
    font-weight: 650;
    letter-spacing: -0.02em;
  }
  .hero-text p {
    margin: 0;
    color: var(--text-muted);
  }
  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }
  .length {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 64px;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text);
    line-height: 1.1;
    transition:
      transform var(--motion-fast) var(--ease),
      background var(--motion-fast) var(--ease);
  }
  .length strong {
    font-size: var(--text-lg);
  }
  .length small {
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
  .length:hover {
    background: var(--surface-hover);
    transform: translateY(-1px);
  }
  .length.main {
    border-color: transparent;
    background: linear-gradient(135deg, var(--accent), var(--accent-2));
    color: var(--on-accent);
  }
  .length.main small {
    color: color-mix(in oklab, var(--on-accent) 80%, transparent);
  }
  :global(.card.sites),
  :global(.card.stats) {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
  }
  textarea {
    width: 100%;
    min-height: 110px;
    padding: var(--space-2) var(--space-3);
    font-family: var(--font-mono, monospace);
    resize: vertical;
  }
  .sites-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .hint {
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
  .total strong {
    font-size: var(--text-xl);
    font-weight: 700;
  }
  .bars {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    align-items: end;
    gap: var(--space-2);
    height: 120px;
  }
  .bar-col {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-1);
    height: 100%;
  }
  .bar {
    width: 100%;
    max-width: 36px;
    border-radius: var(--radius-sm) var(--radius-sm) 2px 2px;
    background: linear-gradient(180deg, var(--accent-2), var(--accent));
  }
  .bar-col small {
    color: var(--text-muted);
    font-size: var(--text-xs);
    text-transform: capitalize;
  }
  .sites-time {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .sites-time li {
    display: grid;
    grid-template-columns: minmax(0, 160px) 1fr auto;
    align-items: center;
    gap: var(--space-3);
  }
  .site {
    overflow: hidden;
    font-weight: 500;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .meter {
    height: 8px;
    border-radius: var(--radius-pill);
    background: var(--surface);
  }
  .meter span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: color-mix(in oklch, var(--accent) 70%, oklch(70% 0.16 var(--hue)));
  }
  .time {
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }
</style>
