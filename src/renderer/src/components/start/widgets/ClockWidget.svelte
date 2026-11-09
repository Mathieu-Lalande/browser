<script lang="ts">
  import { intlLocale } from "@shared/i18n";
  import { greetingFor } from "@shared/start-widgets";
  import { browser } from "../../../lib/browser.svelte";
  import { settings } from "../../../lib/settings.svelte";
  import type { WidgetProps } from "../types";

  let { widget }: WidgetProps<"clock"> = $props();

  let now = $state(new Date());
  $effect(() => {
    const timer = setInterval(() => (now = new Date()), 10_000);
    return () => clearInterval(timer);
  });

  const time = $derived(now.toLocaleTimeString(intlLocale(), { hour: "2-digit", minute: "2-digit" }));
  const date = $derived(now.toLocaleDateString(intlLocale(), { weekday: "long", day: "numeric", month: "long" }));
  const name = $derived(settings.current.startPage.greetingName.trim());
  // A private window's heading is "Navigation privée": the clock is no heading there.
  const showGreeting = $derived(widget.options.greeting && !browser.isPrivate);
  const tag = $derived(browser.isPrivate ? "p" : "h1");
</script>

<div class="clock size-{widget.size}">
  {#if showGreeting}
    <p class="time">{time}{#if widget.options.date}<span class="date"> · {date}</span>{/if}</p>
    <h1 class="heading">{greetingFor(now.getHours())}{#if name}, {name}{/if}.</h1>
  {:else}
    <svelte:element this={tag} class="heading big">{time}</svelte:element>
    {#if widget.options.date}<p class="time date">{date}</p>{/if}
  {/if}
</div>

<style>
  .clock {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    text-align: center;
  }
  .time {
    margin: 0;
    color: var(--text-faint);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.08em;
  }
  .date {
    letter-spacing: 0.02em;
  }
  .heading {
    margin: 0;
    font-size: clamp(32px, 5vw, 52px);
    font-weight: 600;
    letter-spacing: -0.04em;
    background: linear-gradient(120deg, var(--text) 30%, var(--accent-text) 85%);
    background-clip: text;
    color: transparent;
  }
  .big {
    font-variant-numeric: tabular-nums;
  }
  .size-s .heading {
    font-size: var(--text-xl);
  }
</style>
