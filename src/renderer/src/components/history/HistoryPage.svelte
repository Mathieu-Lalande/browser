<script lang="ts">
  import { t as tr, t, intlLocale } from "@shared/i18n";
  import { groupByDay, type HistoryClearRange, type HistoryCursor } from "@shared/history";
  import type { HistoryEntry } from "@shared/types";
  import { displayUrl } from "@shared/url";
  import { api, browser } from "../../lib/browser.svelte";
  import Icon from "../Icon.svelte";
  import Favicon from "../Favicon.svelte";
  import Button from "../ui/Button.svelte";
  import Card from "../ui/Card.svelte";
  import Checkbox from "../ui/Checkbox.svelte";
  import ConfirmButton from "../ui/ConfirmButton.svelte";
  import EmptyState from "../ui/EmptyState.svelte";
  import ListRow from "../ui/ListRow.svelte";
  import Menu from "../ui/Menu.svelte";
  import MenuItem from "../ui/MenuItem.svelte";
  import Page from "../ui/Page.svelte";
  import SearchField from "../ui/SearchField.svelte";
  import { dismiss } from "../ui/dismiss";

  /**
   * `browser://history` (ADR-039): visited pages grouped by day, searched and paged by main (infinite
   * scroll), deleted one by one, by selection or by range. Never listed in a private window.
   */

  const RANGES: { id: HistoryClearRange; label: string }[] = [
    { id: "hour", label: t("historyPage.lastHour") },
    { id: "today", label: t("historyPage.today") },
    { id: "week", label: t("historyPage.last7Days") },
    { id: "all", label: t("historyPage.allHistory") },
  ];

  let query = $state("");
  let entries = $state<HistoryEntry[]>([]);
  let next = $state<HistoryCursor | null>(null);
  let loading = $state(false);
  let selected = $state<Set<string>>(new Set());
  let clearing = $state<HistoryClearRange | null>(null);
  let menuOpen = $state(false);
  let sentinel = $state<HTMLElement>();
  let request = 0;

  const groups = $derived(groupByDay(entries));

  async function load(reset: boolean): Promise<void> {
    if (browser.isPrivate) return;
    const id = reset ? ++request : request;
    loading = true;
    const page = await api.history.page(query, reset ? null : next).catch(() => null);
    if (id !== request) return;
    loading = false;
    if (!page) return;
    entries = reset ? page.entries : [...entries, ...page.entries];
    next = page.next;
    if (reset) selected = new Set();
  }

  $effect(() => {
    void query;
    void load(true);
  });

  // Infinite scroll: the next page loads when the end of the list comes into view.
  $effect(() => {
    if (!sentinel) return;
    const observer = new IntersectionObserver((seen) => {
      if (seen.some((entry) => entry.isIntersecting) && next && !loading) void load(false);
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  });

  function toggle(url: string, checked: boolean): void {
    const updated = new Set(selected);
    if (checked) updated.add(url);
    else updated.delete(url);
    selected = updated;
  }

  async function remove(urls: string[]): Promise<void> {
    await api.history.remove(urls).catch(() => 0);
    const gone = new Set(urls);
    entries = entries.filter((entry) => !gone.has(entry.url));
    selected = new Set([...selected].filter((url) => !gone.has(url)));
  }

  async function clear(range: HistoryClearRange): Promise<void> {
    clearing = null;
    menuOpen = false;
    await api.history.clearRange(range).catch(() => 0);
    await load(true);
  }

  const dayFormat = new Intl.DateTimeFormat(intlLocale(), { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const timeFormat = new Intl.DateTimeFormat(intlLocale(), { hour: "2-digit", minute: "2-digit" });

  function dayLabel(date: number): string {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Math.round((today.getTime() - date) / 86_400_000);
    if (days === 0) return "Aujourd'hui";
    if (days === 1) return tr("historyPage.yesterday");
    const label = dayFormat.format(date);
    return label.charAt(0).toUpperCase() + label.slice(1);
  }
</script>

<Page icon="history" title={t("historyPage.history")} subtitle={t("historyPage.pagesVisitedDeviceMost")} testid="history-page">
  {#snippet actions()}
    {#if !browser.isPrivate}
      <div class="clear" use:dismiss={{ enabled: menuOpen, outside: true, onDismiss: () => ((menuOpen = false), (clearing = null)) }}>
        <Button icon="trash" aria-expanded={menuOpen} onclick={() => ((menuOpen = !menuOpen), (clearing = null))}>{t("historyPage.clearHistory")}</Button>
        {#if menuOpen}
          {#if clearing}
            <div class="menu" role="dialog" aria-label={t("historyPage.confirmClearing")}>
              <p>{t("historyPage.clear", { p: RANGES.find((range) => range.id === clearing)?.label.toLowerCase() })}</p>
              <div class="confirm">
                <Button size="sm" variant="quiet" onclick={() => (clearing = null)}>{t("historyPage.cancel")}</Button>
                <Button size="sm" variant="danger" onclick={() => clearing && clear(clearing)}>{t("historyPage.clear2")}</Button>
              </div>
            </div>
          {:else}
            <Menu class="menu" label={t("historyPage.clearHistory")}>
              {#each RANGES as range (range.id)}
                <MenuItem role="menuitem" icon="clock" iconSize={15} label={range.label} onclick={() => (clearing = range.id)} />
              {/each}
            </Menu>
          {/if}
        {/if}
      </div>
    {/if}
  {/snippet}

  {#if browser.isPrivate}
    <EmptyState icon="mask" title={t("historyPage.historyUnavailablePrivateBrowsing")} hint={t("historyPage.privateWindowsNeitherSave")} />
  {:else}
    <SearchField bind:value={query} label={t("historyPage.searchHistory")} />

    {#if selected.size}
      <div class="selection" role="toolbar" aria-label={t("historyPage.selection")}>
        <span>{t("historyPage.selected", { size: selected.size })}</span>
        <Button size="sm" variant="quiet" onclick={() => (selected = new Set())}>{t("historyPage.cancel")}</Button>
        <ConfirmButton
          variant="outlined"
          question={t("historyPage.deleteEntries", { size: selected.size })}
          confirmLabel={t("historyPage.delete")}
          onconfirm={() => remove([...selected])}
        >
          <Icon name="trash" size={12} /> {t("historyPage.deleteSelection")}
        </ConfirmButton>
      </div>
    {/if}

    {#each groups as group (group.day)}
      <section class="day" data-day={group.day}>
        <h2>{dayLabel(group.date)}</h2>
        <Card as="ul">
          {#each group.entries as entry (entry.url)}
            <ListRow dense class="history-row" data-url={entry.url}>
              <Checkbox checked={selected.has(entry.url)} onchange={(checked) => toggle(entry.url, checked)}>
                <span class="sr">{t("historyPage.select", { p: entry.title || displayUrl(entry.url) })}</span>
              </Checkbox>
              <span class="time">{timeFormat.format(entry.lastVisit)}</span>
              <Favicon src={entry.favicon} />
              <button class="text" title={entry.url} onclick={() => api.tabs.create(entry.url)}>
                <span class="title">{entry.title || displayUrl(entry.url)}</span>
                <span class="detail">{displayUrl(entry.url)}</span>
              </button>
              <ConfirmButton
                variant="ghost"
                question={t("historyPage.deleteEntry")}
                confirmLabel={t("historyPage.delete")}
                title={t("historyPage.deleteFromHistory")}
                onconfirm={() => remove([entry.url])}
              >
                <Icon name="trash" size={16} />
                <span class="sr">{t("historyPage.deleteFromHistory2", { p: entry.title || displayUrl(entry.url) })}</span>
              </ConfirmButton>
            </ListRow>
          {/each}
        </Card>
      </section>
    {:else}
      {#if !loading}
        {#if query}
          <EmptyState icon="search" title={t("historyPage.noResults")} hint={t("historyPage.noVisitedPageMatches")} />
        {:else}
          <EmptyState icon="history" title={t("historyPage.noVisitedPages")} hint={t("historyPage.pagesYouOpenWill")} />
        {/if}
      {/if}
    {/each}
    <div bind:this={sentinel} class="sentinel" aria-hidden="true"></div>
  {/if}
</Page>

<style>
  .day {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  h2 {
    margin: var(--space-3) 0 0;
    color: var(--text-muted);
    font-size: var(--text-sm);
    font-weight: 600;
  }
  .text {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    padding: 0;
    color: inherit;
    text-align: left;
  }
  .title,
  .detail {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .detail,
  .time {
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
  .time {
    flex: none;
    font-variant-numeric: tabular-nums;
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  .selection {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
  }
  .selection span {
    flex: 1;
  }
  .clear {
    position: relative;
  }
  .clear :global(.menu) {
    position: absolute;
    z-index: 20;
    top: calc(100% + var(--space-1));
    right: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 220px;
    padding: var(--space-1);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-elevated);
    box-shadow: 0 12px 32px -12px rgb(0 0 0 / 0.5);
  }
  .clear p {
    margin: var(--space-2);
    font-size: var(--text-sm);
  }
  .confirm {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-1);
  }
  .sentinel {
    height: 1px;
  }
</style>
