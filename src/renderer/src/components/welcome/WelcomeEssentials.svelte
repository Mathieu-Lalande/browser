<script lang="ts">
  import { effectiveAccelerator } from "@shared/commands";
  import { acceleratorKeys } from "@shared/accelerators";
  import { WELCOME_TIPS, type WelcomeTipDefinition } from "@shared/onboarding";
  import { api } from "../../lib/browser.svelte";
  import { platform } from "../../lib/platform.svelte";
  import { settings } from "../../lib/settings.svelte";
  import Button from "../ui/Button.svelte";

  /**
   * Welcome, step 5 (ADR-043): four cards, each with a small looping illustration drawn in HTML and
   * CSS (no video). With reduced motion, the global rule stops the loops on their resting frame.
   */

  const keysOf = (tip: WelcomeTipDefinition): string[] => {
    if (!tip.command) return tip.gesture ? [tip.gesture] : [];
    const accelerator = effectiveAccelerator(tip.command, platform.name, settings.current.shortcuts);
    return accelerator ? acceleratorKeys(accelerator, platform.name) : [];
  };
  const compact = $derived(settings.current.layout.compactMode);
</script>

<ul class="tips">
  {#each WELCOME_TIPS as tip (tip.id)}
    <li class="tip" data-tip={tip.id}>
      <div class="art {tip.id}" aria-hidden="true">
        {#if tip.id === "omnibox"}
          <div class="bar"><i class="caret"></i></div>
          <div class="results"><i></i><i></i><i></i></div>
        {:else if tip.id === "spaces"}
          <div class="track"><div class="panel a"><i></i><i></i></div><div class="panel b"><i></i><i></i></div></div>
          <div class="fingers"><i></i><i></i></div>
        {:else if tip.id === "peek"}
          <div class="pagebg"><i></i><i class="link"></i><i></i></div>
          <div class="card"><b></b><i></i><i></i></div>
        {:else}
          <div class="side"><i></i><i></i><i></i></div>
          <div class="content"></div>
        {/if}
      </div>
      <div class="text">
        <h2>{tip.title}</h2>
        <p>{tip.text}</p>
        <div class="foot">
          {#each keysOf(tip) as key, index (index)}<kbd>{key}</kbd>{/each}
          {#if tip.id === "compact"}
            <Button size="sm" variant="quiet" aria-pressed={compact} onclick={() => api.commands.run("toggle-compact-mode")}>
              {compact ? "Désactiver" : "Essayer"}
            </Button>
          {/if}
        </div>
      </div>
    </li>
  {/each}
</ul>

<style>
  .tips {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .tip {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
  }
  .text {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-3);
  }
  h2 {
    margin: 0;
    font-size: var(--text-md);
    font-weight: 600;
  }
  p {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-sm);
    line-height: 1.45;
  }
  .foot {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-height: 28px;
    margin-top: var(--space-1);
  }
  kbd {
    padding: 2px 6px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    font: inherit;
    font-size: var(--text-xs);
  }

  /* --- Illustrations: plain boxes, a 2.4-3 s loop each. ----------------------------------- */
  .art {
    position: relative;
    height: 112px;
    overflow: hidden;
    background: color-mix(in oklab, var(--accent) 8%, var(--bg));
  }
  .art i,
  .art b {
    display: block;
    border-radius: 3px;
  }

  .omnibox .bar {
    position: absolute;
    top: 18px;
    left: 15%;
    width: 70%;
    height: 22px;
    border-radius: 11px;
    background: var(--surface);
    box-shadow: 0 0 0 1px var(--border);
  }
  .omnibox .caret {
    position: absolute;
    top: 6px;
    left: 12px;
    width: 40%;
    height: 10px;
    background: color-mix(in oklab, var(--text) 30%, transparent);
    transform-origin: left;
    animation: type 2.6s steps(8) infinite;
  }
  .omnibox .results {
    position: absolute;
    top: 46px;
    left: 15%;
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 70%;
    animation: reveal 2.6s var(--ease) infinite;
  }
  .omnibox .results i {
    height: 12px;
    background: var(--surface);
  }
  .omnibox .results i:first-child {
    background: color-mix(in oklab, var(--accent) 35%, var(--surface));
  }
  @keyframes type {
    0% {
      transform: scaleX(0);
    }
    45%,
    100% {
      transform: scaleX(1);
    }
  }
  @keyframes reveal {
    0%,
    35% {
      opacity: 0;
      transform: translateY(-4px);
    }
    50%,
    90% {
      opacity: 1;
      transform: none;
    }
    100% {
      opacity: 0;
    }
  }

  .spaces .track {
    position: absolute;
    inset: 16px 0 16px 20%;
    display: flex;
    gap: 12px;
    animation: swipe 3s var(--ease) infinite;
  }
  .spaces .panel {
    display: flex;
    flex: none;
    flex-direction: column;
    gap: 6px;
    width: 30%;
    padding: 8px;
    border-radius: 8px;
    background: var(--surface);
  }
  .spaces .panel i {
    height: 10px;
    background: color-mix(in oklab, var(--accent) 40%, var(--surface));
  }
  .spaces .panel.b i {
    background: color-mix(in oklab, var(--accent-2) 45%, var(--surface));
  }
  .spaces .fingers {
    position: absolute;
    bottom: 22px;
    left: 34%;
    display: flex;
    gap: 6px;
    animation: fingers 3s var(--ease) infinite;
  }
  .spaces .fingers i {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: color-mix(in oklab, var(--text) 35%, transparent);
  }
  @keyframes swipe {
    0%,
    25% {
      transform: none;
    }
    50%,
    75% {
      transform: translateX(calc(-30% - 12px));
    }
    100% {
      transform: none;
    }
  }
  @keyframes fingers {
    0% {
      opacity: 0;
      transform: translateX(30px);
    }
    15% {
      opacity: 1;
    }
    45% {
      opacity: 1;
      transform: translateX(-30px);
    }
    55%,
    100% {
      opacity: 0;
      transform: translateX(-30px);
    }
  }

  .peek .pagebg {
    position: absolute;
    inset: 14px 18%;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .peek .pagebg i {
    height: 10px;
    background: var(--surface);
  }
  .peek .pagebg .link {
    width: 40%;
    background: color-mix(in oklab, var(--accent) 50%, var(--surface));
  }
  .peek .card {
    position: absolute;
    inset: 22px 26%;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    border-radius: 8px;
    background: var(--bg-elevated);
    box-shadow: 0 6px 18px rgb(0 0 0 / 0.18);
    animation: peek 2.8s var(--ease) infinite;
  }
  .peek .card b {
    height: 8px;
    width: 50%;
    background: color-mix(in oklab, var(--accent) 50%, var(--surface));
  }
  .peek .card i {
    height: 8px;
    background: var(--surface);
  }
  @keyframes peek {
    0%,
    20% {
      opacity: 0;
      transform: scale(0.85);
    }
    35%,
    85% {
      opacity: 1;
      transform: none;
    }
    100% {
      opacity: 0;
      transform: scale(0.95);
    }
  }

  .compact .side {
    position: absolute;
    top: 14px;
    bottom: 14px;
    left: 14px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 30%;
    padding: 8px;
    border-radius: 8px;
    background: var(--surface);
    animation: rail 3s var(--ease) infinite;
  }
  .compact .side i {
    height: 10px;
    background: color-mix(in oklab, var(--accent) 35%, var(--surface));
  }
  .compact .content {
    position: absolute;
    top: 14px;
    right: 14px;
    bottom: 14px;
    left: calc(30% + 22px);
    border-radius: 8px;
    background: var(--bg-elevated);
    animation: grow 3s var(--ease) infinite;
  }
  @keyframes rail {
    0%,
    25%,
    100% {
      width: 30%;
    }
    45%,
    80% {
      width: 26px;
    }
  }
  @keyframes grow {
    0%,
    25%,
    100% {
      left: calc(30% + 22px);
    }
    45%,
    80% {
      left: 54px;
    }
  }
</style>
