<script lang="ts">
  import { internalPageOf } from "@shared/internal";
  import {
    WELCOME_STEPS,
    WELCOME_STEP_LABELS,
    goToWelcome,
    initialWelcome,
    isLastStep,
    nextWelcome,
    previousWelcome,
    welcomeIndex,
    welcomeKeyAction,
    type WelcomeState,
  } from "@shared/onboarding";
  import { api, browser } from "../../lib/browser.svelte";
  import { settings } from "../../lib/settings.svelte";
  import Icon from "../Icon.svelte";
  import Button from "../ui/Button.svelte";
  import WelcomeDefault from "./WelcomeDefault.svelte";
  import WelcomeEssentials from "./WelcomeEssentials.svelte";
  import WelcomeImport from "./WelcomeImport.svelte";
  import WelcomeTheme from "./WelcomeTheme.svelte";

  /**
   * `browser://welcome` (ADR-043): the first-run onboarding, five short steps. Each step can be
   * passed; "Passer" (or Échap) ends it all. Finishing or skipping is remembered in the settings
   * (`onboarding.completed`), and the tab becomes a start page.
   */

  let flow = $state<WelcomeState>(initialWelcome());
  let root: HTMLElement;
  /** Which way the step content slides in. */
  let direction = $state<1 | -1>(1);
  const index = $derived(welcomeIndex(flow.step));

  function finish(): void {
    settings.update({ onboarding: { completed: true } });
    const tab = browser.state.tabs.find((candidate) => internalPageOf(candidate.url) === "welcome");
    api.tabs.create();
    if (tab) api.tabs.close(tab.id);
  }

  function next(): void {
    const following = nextWelcome(flow);
    if (!following) return finish();
    direction = 1;
    flow = following;
  }

  function previous(): void {
    direction = -1;
    flow = previousWelcome(flow);
  }

  function onkeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    // Keys typed in the address bar, the sidebar or a field are theirs.
    if (event.defaultPrevented || !(target === document.body || root?.contains(target))) return;
    if (target.closest("input, textarea, select, [role=radiogroup]")) return;
    const action = welcomeKeyAction(event.key);
    if (!action) return;
    event.preventDefault();
    if (action === "next") next();
    else if (action === "previous") previous();
    else finish();
  }

  $effect(() => {
    root?.focus({ preventScroll: true });
  });
</script>

<svelte:window {onkeydown} />

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div class="welcome" data-testid="welcome-page" data-step={flow.step} tabindex="-1" bind:this={root} role="region" aria-label="Bienvenue dans Browser">
  <div class="inner">
    <ol class="dots" aria-label="Étapes">
      {#each WELCOME_STEPS as step, position (step)}
        <li>
          <button
            class="dot"
            class:done={position < index}
            aria-current={step === flow.step ? "step" : undefined}
            aria-label={`${position + 1}. ${WELCOME_STEP_LABELS[step]}`}
            title={WELCOME_STEP_LABELS[step]}
            onclick={() => ((direction = position >= index ? 1 : -1), (flow = goToWelcome(flow, step)))}
          ></button>
        </li>
      {/each}
    </ol>

    {#key flow.step}
      <section class="step" class:back={direction < 0} aria-labelledby="welcome-title">
        {#if flow.step === "hello"}
          <span class="badge"><Icon name="sparkle" size={28} /></span>
          <h1 id="welcome-title">Bienvenue dans Browser</h1>
          <p class="lead">
            Un navigateur rapide, privé et à votre image. Quatre petites étapes pour le régler, une minute en tout ; chacune peut être passée.
          </p>
          <ul class="promises">
            <li><Icon name="shield" size={16} /> Publicités et pisteurs bloqués d'office</li>
            <li><Icon name="layers" size={16} /> Des espaces pour séparer travail et perso</li>
            <li><Icon name="cloud-off" size={16} /> Vos données restent sur cet appareil</li>
          </ul>
        {:else if flow.step === "theme"}
          <h1 id="welcome-title">Choisissez un thème</h1>
          <p class="lead">Il s'applique tout de suite. Couleurs, police et densité se règlent ensuite dans les paramètres.</p>
          <WelcomeTheme />
        {:else if flow.step === "import"}
          <h1 id="welcome-title">Importer depuis votre navigateur</h1>
          <p class="lead">Favoris, historique et moteur de recherche, sans doublons. Rien ne quitte votre ordinateur.</p>
          <WelcomeImport />
        {:else if flow.step === "default"}
          <h1 id="welcome-title">Navigateur par défaut</h1>
          <p class="lead">Les liens ouverts depuis vos autres applications, et les fichiers HTML et PDF, s'ouvriront ici.</p>
          <WelcomeDefault />
        {:else}
          <h1 id="welcome-title">L'essentiel</h1>
          <p class="lead">Quatre gestes qui changent tout. Les retrouver plus tard : Aide, Visite guidée.</p>
          <WelcomeEssentials />
        {/if}
      </section>
    {/key}

    <footer>
      <Button variant="quiet" onclick={finish} data-testid="welcome-skip">Passer</Button>
      <span class="spacer"></span>
      {#if index > 0}<Button onclick={previous}>Retour</Button>{/if}
      <Button variant="primary" onclick={next} data-testid="welcome-next">
        {isLastStep(flow) ? "Commencer à naviguer" : index === 0 ? "C'est parti" : "Suivant"}
        <Icon name="chevron-right" size={14} />
      </Button>
    </footer>
  </div>
</div>

<style>
  .welcome {
    container: welcome / inline-size;
    height: 100%;
    overflow-y: auto;
    outline: none;
  }
  .inner {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    min-height: 100%;
    max-width: 760px;
    margin: 0 auto;
    padding: var(--space-6) var(--space-6) var(--space-5);
    box-sizing: border-box;
  }
  .dots {
    display: flex;
    justify-content: center;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .dot {
    width: 28px;
    height: 6px;
    padding: 0;
    border-radius: 3px;
    background: var(--surface-hover);
    transition:
      background var(--motion-fast) var(--ease),
      width var(--motion-fast) var(--ease);
  }
  /* A larger hit target than the bar itself. */
  .dot::after {
    content: "";
    display: block;
    margin: -10px 0;
    height: 26px;
  }
  .dot.done {
    background: color-mix(in oklab, var(--accent) 45%, var(--surface-hover));
  }
  .dot[aria-current="step"] {
    width: 44px;
    background: var(--accent);
  }
  .step {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--space-3);
    animation: step-in var(--motion-base) var(--ease);
  }
  .step.back {
    animation-name: step-back;
  }
  @keyframes step-in {
    from {
      opacity: 0;
      transform: translateX(12px);
    }
  }
  @keyframes step-back {
    from {
      opacity: 0;
      transform: translateX(-12px);
    }
  }
  .badge {
    display: grid;
    place-items: center;
    width: 56px;
    height: 56px;
    border-radius: var(--radius-lg);
    background: linear-gradient(135deg, var(--accent), var(--accent-2));
    color: var(--on-accent);
  }
  h1 {
    margin: 0;
    font-size: var(--text-xl);
    font-weight: 650;
    letter-spacing: -0.01em;
  }
  .lead {
    margin: 0;
    max-width: 60ch;
    color: var(--text-muted);
    font-size: var(--text-md);
    line-height: 1.5;
  }
  .promises {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: var(--space-2) 0 0;
    padding: 0;
    list-style: none;
    font-size: var(--text-sm);
  }
  .promises li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .promises :global(svg) {
    color: var(--accent-text);
  }
  footer {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding-top: var(--space-3);
    border-top: 1px solid var(--border);
  }
  .spacer {
    flex: 1;
  }
  @container welcome (max-width: 520px) {
    .inner {
      padding: var(--space-4);
    }
  }
</style>
