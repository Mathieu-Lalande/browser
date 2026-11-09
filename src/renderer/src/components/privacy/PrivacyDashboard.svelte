<script lang="ts">
  import { t, intlLocale } from "@shared/i18n";
  import { PRIVACY_COUNTERS, PRIVACY_COUNTER_LABELS, formatSaved, type PrivacyCounter, type PrivacySummary } from "@shared/privacy-stats";
  import { api, browser } from "../../lib/browser.svelte";
  import type { IconName } from "../Icon.svelte";
  import Icon from "../Icon.svelte";
  import Button from "../ui/Button.svelte";
  import Card from "../ui/Card.svelte";
  import ConfirmButton from "../ui/ConfirmButton.svelte";
  import EmptyState from "../ui/EmptyState.svelte";
  import ListRow from "../ui/ListRow.svelte";
  import Page from "../ui/Page.svelte";

  /**
   * `browser://privacy` (ADR-046): what the protections did over the last 30 days, from aggregated
   * counters kept on this device (never a URL; private windows record nothing). Refreshed every
   * few seconds while shown; a site of the top list narrows everything to it.
   */

  const REFRESH_MS = 5_000;
  const ICONS: Record<PrivacyCounter, IconName> = {
    trackers: "shield",
    cookieBanners: "cookie",
    httpsUpgrades: "lock",
    thirdPartyCookies: "globe-off",
    fingerprinting: "eye-off",
  };

  let summary = $state<PrivacySummary | null>(null);
  let site = $state<string | null>(null);

  async function refresh(): Promise<void> {
    const wanted = site;
    const next = await api.privacyStats.summary(wanted).catch(() => null);
    if (next && wanted === site) summary = next;
  }

  $effect(() => {
    void site;
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  });

  async function clear(): Promise<void> {
    const next = await api.privacyStats.clear(site).catch(() => null);
    if (next) {
      site = null;
      summary = next;
    }
  }

  const peak = $derived(Math.max(1, ...(summary?.daily.map((day) => day.counts.trackers) ?? [0])));
  const hasData = $derived(!!summary && PRIVACY_COUNTERS.some((counter) => summary!.totals[counter] > 0));
  const number = new Intl.NumberFormat(intlLocale());
  const dayLabel = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(intlLocale(), { day: "numeric", month: "short" });
</script>

<Page
  icon="shield-check"
  title={site ? t("privacyDashboard.privacy", { site }) : t("privacyDashboard.privacy2")}
  subtitle={t("privacyDashboard.whatProtectionsDidOver")}
  testid="privacy-page"
>
  {#snippet actions()}
    {#if site}<Button icon="back" variant="quiet" onclick={() => (site = null)}>{t("privacyDashboard.allSites")}</Button>{/if}
    <Button icon="sliders" onclick={() => api.commands.run("open-site-settings")}>{t("privacyDashboard.siteSettings")}</Button>
  {/snippet}

  {#if summary}
    <section class="tiles" aria-label={t("privacyDashboard.totalsOver30Days")}>
      {#each PRIVACY_COUNTERS as counter (counter)}
        <div class="tile" data-counter={counter}>
          <Icon name={ICONS[counter]} size={16} />
          <span class="value">{number.format(summary.totals[counter])}</span>
          <span class="label">{PRIVACY_COUNTER_LABELS[counter]}</span>
        </div>
      {/each}
      <div class="tile">
        <Icon name="clock" size={16} />
        <span class="value">{formatSaved(summary.savedMs)}</span>
        <span class="label">{t("privacyDashboard.timeSavedEstimate")}</span>
      </div>
    </section>

    {#if hasData}
      <section class="section">
        <h2 class="heading">{t("privacyDashboard.trackersBlockedPerDay")}</h2>
        <div class="chart" role="img" aria-label={t("privacyDashboard.trackersBlockedEachDay")}>
          {#each summary.daily as day (day.day)}
            <span class="bar" style:height="{(day.counts.trackers / peak) * 100}%" title="{dayLabel(day.day)} : {number.format(day.counts.trackers)}"></span>
          {/each}
        </div>
      </section>

      <div class="columns">
        {#if !site}
          <section class="section" aria-labelledby="top-sites">
            <h2 class="heading" id="top-sites">{t("privacyDashboard.mostProtectedSites")}</h2>
            <Card>
              {#each summary.topSites as entry (entry.name)}
                <ListRow dense>
                  <button class="link" onclick={() => (site = entry.name)}>{entry.name}</button>
                  <span class="count">{number.format(entry.count)}</span>
                </ListRow>
              {/each}
            </Card>
          </section>
          <section class="section" aria-labelledby="top-trackers">
            <h2 class="heading" id="top-trackers">{t("privacyDashboard.mostBlockedTrackers")}</h2>
            <Card>
              {#each summary.topTrackers as entry (entry.name)}
                <ListRow dense>
                  <span class="name">{entry.name}</span>
                  <span class="count">{number.format(entry.count)}</span>
                </ListRow>
              {/each}
            </Card>
          </section>
        {/if}
      </div>
    {:else}
      <EmptyState icon="shield-check" title={t("privacyDashboard.nothingReportYet")} hint={t("privacyDashboard.blockedTrackersRefusedBanners")} />
    {/if}

    {#if browser.isPrivate}
      <p class="hint"><Icon name="mask" size={12} /> {t("privacyDashboard.privateWindowNothingDoes")}</p>
    {:else if hasData}
      <div class="footer">
        <ConfirmButton question={site ? t("privacyDashboard.clearStatistics", { site }) : t("privacyDashboard.clearAllStatistics")} confirmLabel={t("privacyDashboard.clear")} onconfirm={clear}>
          <Icon name="trash" size={14} /> {t("privacyDashboard.clearStatistics2")}
        </ConfirmButton>
      </div>
    {/if}
  {/if}
</Page>

<style>
  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: var(--space-2);
  }
  .tile {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text-muted);
  }
  .value {
    color: var(--text);
    font-size: var(--text-lg);
    font-weight: 650;
    font-variant-numeric: tabular-nums;
  }
  .label {
    font-size: var(--text-xs);
  }
  .chart {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 96px;
    padding: var(--space-2);
    border-radius: var(--radius-md);
    background: var(--surface);
  }
  .bar {
    flex: 1;
    min-height: 2px;
    border-radius: var(--radius-sm) var(--radius-sm) 0 0;
    background: var(--accent);
  }
  .columns {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: var(--space-4);
  }
  .link,
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    padding: 0;
    color: var(--text);
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .link:hover {
    color: var(--accent-text);
    text-decoration: underline;
  }
  .count {
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .footer {
    display: flex;
    justify-content: flex-end;
  }
  .section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-top: var(--space-4);
  }
  .heading {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .hint {
    color: var(--text-faint);
    font-size: var(--text-xs);
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
</style>
