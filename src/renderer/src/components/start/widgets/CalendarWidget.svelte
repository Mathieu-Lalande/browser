<script lang="ts">
  import { t, intlLocale } from "@shared/i18n";
  import { monthGrid } from "@shared/start-widgets";
  import type { WidgetProps } from "../types";

  let { widget }: WidgetProps<"calendar"> = $props();
  const WEEKDAYS = ["L", "M", "M", "J", "V", "S", "D"];

  let today = $state(new Date());
  $effect(() => {
    const timer = setInterval(() => (today = new Date()), 60_000);
    return () => clearInterval(timer);
  });

  const month = $derived(monthGrid(today));
  const title = $derived(today.toLocaleDateString(intlLocale(), { month: "long", year: "numeric" }));
  const long = $derived(today.toLocaleDateString(intlLocale(), { weekday: "long", day: "numeric", month: "long" }));
</script>

<h2 class="widget-title"><span class="month">{title}</span></h2>
{#if widget.size !== "s"}<p class="today">{long}</p>{/if}
<table class:weeks={widget.options.weekNumbers} aria-label={t("calendarWidget.calendar", { title })}>
  <thead>
    <tr>
      {#if widget.options.weekNumbers}<th scope="col" class="week" aria-label={t("calendarWidget.week")}>S</th>{/if}
      {#each WEEKDAYS as day, index (index)}<th scope="col">{day}</th>{/each}
    </tr>
  </thead>
  <tbody>
    {#each month.weeks as week, row (row)}
      <tr>
        {#if widget.options.weekNumbers}<td class="week">{month.weekNumbers[row]}</td>{/if}
        {#each week as day, index (index)}
          <td class:out={!day.inMonth} class:today={day.today} aria-current={day.today ? "date" : undefined}>{day.day}</td>
        {/each}
      </tr>
    {/each}
  </tbody>
</table>

<style>
  .month::first-letter {
    text-transform: uppercase;
  }
  .today {
    margin: calc(-1 * var(--space-1)) 0 var(--space-2);
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    text-align: center;
  }
  th {
    padding-bottom: var(--space-1);
    color: var(--text-faint);
    font-weight: 500;
  }
  td {
    height: var(--space-5);
    border-radius: var(--radius-sm);
    color: var(--text);
  }
  td.out {
    color: var(--text-faint);
    opacity: 0.5;
  }
  td.today {
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 600;
  }
  .week {
    color: var(--text-faint);
    font-size: calc(var(--text-xs) - 2px);
  }
</style>
