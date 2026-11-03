<script lang="ts">
  import { tick } from "svelte";
  import { internalFragment } from "@shared/internal";
  import { browser } from "../../lib/browser.svelte";
  import { settings } from "../../lib/settings.svelte";
  import Icon, { type IconName } from "../Icon.svelte";
  import Button from "../ui/Button.svelte";
  import ConfirmButton from "../ui/ConfirmButton.svelte";
  import EmptyState from "../ui/EmptyState.svelte";
  import SearchField from "../ui/SearchField.svelte";
  import { queryFilter, setRowFilter } from "../ui/filter";
  import AppearanceSection from "./AppearanceSection.svelte";
  import AutofillSection from "./AutofillSection.svelte";
  import NotificationsSection from "./NotificationsSection.svelte";
  import SpellcheckSection from "./SpellcheckSection.svelte";
  import BehaviorSection from "./BehaviorSection.svelte";
  import DataSection from "./DataSection.svelte";
  import DownloadsSection from "./DownloadsSection.svelte";
  import LayoutSection from "./LayoutSection.svelte";
  import PrivacySection from "./PrivacySection.svelte";
  import SearchSection from "./SearchSection.svelte";
  import Section from "./Section.svelte";
  import ShortcutsSection from "./ShortcutsSection.svelte";
  import SiteDataSection from "./SiteDataSection.svelte";
  import StartPageSection from "./StartPageSection.svelte";
  import SyncSection from "./SyncSection.svelte";
  import TranslateSection from "./TranslateSection.svelte";
  import AssistantSection from "./AssistantSection.svelte";
  import UpdatesSection from "./UpdatesSection.svelte";
  import DiagnosticsSection from "./DiagnosticsSection.svelte";

  /**
   * browser://settings: side navigation, search, and the sections (one component each, wrapped in
   * `Section`). Deep links (`#section/row`) scroll to a section's `data-setting` row.
   */
  const NAV: { id: string; label: string; icon: IconName }[] = [
    { id: "appearance", label: "Apparence", icon: "palette" },
    { id: "layout", label: "Disposition", icon: "sidebar" },
    { id: "search", label: "Recherche", icon: "search" },
    { id: "startPage", label: "Page d'accueil", icon: "home" },
    { id: "behavior", label: "Comportement", icon: "sliders" },
    { id: "shortcuts", label: "Raccourcis clavier", icon: "keyboard" },
    { id: "privacy", label: "Confidentialité", icon: "shield" },
    { id: "autofill", label: "Adresses et paiements", icon: "credit-card" },
    { id: "siteData", label: "Données des sites", icon: "cookie" },
    { id: "notifications", label: "Notifications", icon: "bell" },
    { id: "translate", label: "Traduction", icon: "languages" },
    { id: "assistant", label: "Assistant IA", icon: "sparkles" },
    { id: "spellcheck", label: "Orthographe", icon: "spell-check" },
    { id: "downloads", label: "Téléchargements", icon: "download" },
    { id: "data", label: "Données", icon: "database" },
    { id: "sync", label: "Synchronisation", icon: "cloud" },
    { id: "updates", label: "Mises à jour", icon: "update" },
    { id: "diagnostics", label: "Diagnostic", icon: "bug" },
  ];

  /** Settings search: rows hide themselves when they do not match (ui/filter.ts). */
  let query = $state("");
  setRowFilter(queryFilter(() => query));
  /** Sections left visible by the search (all of them without one). */
  let visible = $state<Set<string> | null>(null);
  $effect(() => {
    void query;
    tick().then(() => {
      if (!query.trim()) return void (visible = null);
      const shown = [...inner.querySelectorAll<HTMLElement>("[data-section]")].filter((section) => section.offsetHeight > 0);
      visible = new Set(shown.map((section) => section.dataset.section!));
      content.scrollTo({ top: 0 });
      if (shown[0]) current = shown[0].dataset.section!;
    });
  });

  let content: HTMLElement;
  let inner: HTMLElement;
  let current = $state("appearance");
  /** Section the user jumped to: kept highlighted until the scroll it started settles. */
  let jumping: string | null = null;
  let jumpTimer: ReturnType<typeof setTimeout> | undefined;
  /** Room after the last section, so every section (the last ones too) can scroll to the top. */
  let tail = $state(0);

  // Highlight the section being read in the side navigation: the last one whose title passed
  // the top third, or the last one once scrolled to the bottom.
  function onScroll(): void {
    if (jumping) return;
    const sections = [...content.querySelectorAll<HTMLElement>("[data-section]")];
    const top = content.getBoundingClientRect().top + content.clientHeight / 3;
    const atBottom = content.scrollTop + content.clientHeight >= content.scrollHeight - 4;
    const reading = atBottom ? sections.at(-1) : sections.filter((section) => section.getBoundingClientRect().top <= top).at(-1);
    current = reading?.dataset.section ?? NAV[0].id;
  }

  /** Scrolls to a section, or to `target` inside it (a third down the column). */
  function jump(id: string, target?: HTMLElement): void {
    const section = content.querySelector<HTMLElement>(`[data-section="${id}"]`);
    if (!section) return;
    current = id;
    jumping = id;
    const settle = () => {
      clearTimeout(jumpTimer);
      jumping = null;
    };
    content.addEventListener("scrollend", settle, { once: true });
    // No scrollend when the content was already there; never keep the scroll spy off for long.
    clearTimeout(jumpTimer);
    jumpTimer = setTimeout(settle, 1000);
    const element = target ?? section;
    const margin = target ? content.clientHeight / 3 : parseFloat(getComputedStyle(section).scrollMarginTop) || 0;
    const top = element.getBoundingClientRect().top - content.getBoundingClientRect().top + content.scrollTop - margin;
    // Only the settings column scrolls: scrollIntoView would also nudge its scrollable ancestors.
    const reduceMotion = settings.current.appearance.reduceMotion || matchMedia("(prefers-reduced-motion: reduce)").matches;
    content.scrollTo({ top, behavior: reduceMotion ? "auto" : "smooth" });
  }

  $effect(() => {
    const measure = () => {
      const last = [...inner.querySelectorAll<HTMLElement>("[data-section]")].at(-1);
      if (!last) return;
      const margin = parseFloat(getComputedStyle(last).scrollMarginTop) || 0;
      const below = inner.getBoundingClientRect().bottom - last.getBoundingClientRect().top;
      tail = Math.max(0, Math.ceil(content.clientHeight - margin - below));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    observer.observe(inner);
    return () => {
      observer.disconnect();
      clearTimeout(jumpTimer);
    };
  });

  // Deep links from the universal bar (ADR-032): `browser://settings#section/row` scrolls to the
  // section and highlights the row. Runs again when the same tab is sent to another row.
  const fragment = $derived(internalFragment(browser.activeTab?.url ?? ""));
  $effect(() => {
    if (!fragment) return;
    const [sectionId, row] = fragment.split("/");
    // After layout: the page may have just been mounted.
    requestAnimationFrame(() => {
      const target = row ? content.querySelector<HTMLElement>(`[data-section="${CSS.escape(sectionId)}"] [data-setting="${CSS.escape(row)}"]`) : null;
      jump(sectionId, target ?? undefined);
      if (!target) return;
      // Restart the wash if the same row is reached again.
      target.removeAttribute("data-flash");
      void target.offsetWidth;
      target.setAttribute("data-flash", "");
      target.addEventListener("animationend", () => target.removeAttribute("data-flash"), { once: true });
    });
  });

</script>

<div class="settings">
  <nav class="toc" aria-label="Sections des paramètres">
    {#each NAV as item (item.id)}
      <button
        class:current={current === item.id}
        class:dim={visible !== null && !visible.has(item.id)}
        aria-current={current === item.id ? "true" : undefined}
        title={item.label}
        onclick={() => jump(item.id)}
      >
        <Icon name={item.icon} size={16} />
        <span class="toc-label">{item.label}</span>
      </button>
    {/each}
    <div class="reset-all">
      <ConfirmButton question="Tous les réglages par défaut ?" confirmLabel="Tout réinitialiser" onconfirm={() => settings.reset()}>
        <Icon name="reset" size={12} /> <span class="toc-label">Tout réinitialiser</span>
      </ConfirmButton>
    </div>
  </nav>

  <div class="content" bind:this={content} onscroll={onScroll}>
    <div class="inner" bind:this={inner}>
      <header class="top">
        <h1>Paramètres</h1>
        <div class="search"><SearchField bind:value={query} label="Rechercher un réglage" /></div>
      </header>
      {#if visible?.size === 0}
        <EmptyState icon="search" title="Aucun réglage trouvé" hint="Essayez un autre mot : « thème », « onglets », « cookies »…">
          {#snippet action()}<Button onclick={() => (query = "")}>Effacer la recherche</Button>{/snippet}
        </EmptyState>
      {/if}
      <Section
        id="appearance"
        icon="palette"
        title="Apparence"
        description="Couleurs, ambiance et typographie de l'interface."
        onReset={() => settings.reset("appearance")}
      >
        <AppearanceSection />
      </Section>

      <Section
        id="layout"
        icon="sidebar"
        title="Disposition"
        description="Place de la barre latérale et de la page."
        onReset={() => settings.reset("layout")}
      >
        <LayoutSection />
      </Section>

      <Section
        id="search"
        icon="search"
        title="Recherche"
        description="Moteur utilisé par la barre d'adresse et la page d'accueil."
        onReset={() => settings.reset("search")}
      >
        <SearchSection />
      </Section>

      <Section
        id="startPage"
        icon="home"
        title="Page d'accueil"
        description="Ce qu'affiche un nouvel onglet."
        onReset={() => settings.reset("startPage")}
      >
        <StartPageSection />
      </Section>

      <Section
        id="behavior"
        icon="sliders"
        title="Comportement"
        description="Démarrage et gestion des onglets."
        onReset={() => settings.reset("behavior")}
      >
        <BehaviorSection />
      </Section>

      <Section
        id="shortcuts"
        icon="keyboard"
        title="Raccourcis clavier"
        description="Choisissez la combinaison de chaque commande, ou retirez-la."
        keywords="touches combinaison clavier accélérateur"
      >
        <ShortcutsSection />
      </Section>

      <Section
        id="privacy"
        icon="shield"
        title="Confidentialité"
        description="Ce que le navigateur révèle de vous aux sites."
        onReset={() => settings.reset("privacy")}
      >
        <PrivacySection />
      </Section>

      <Section
        id="autofill"
        icon="credit-card"
        title="Adresses et paiements"
        description="Adresses et cartes chiffrées sur cet appareil, proposées dans les formulaires."
        keywords="autofill remplissage automatique carte bancaire adresse"
        onReset={() => settings.reset("autofill")}
      >
        <AutofillSection />
      </Section>

      <Section id="siteData" icon="cookie" title="Données des sites" description="Cookies et stockage laissés par les sites, et cookies tiers.">
        <SiteDataSection />
      </Section>

      <Section
        id="notifications"
        icon="bell"
        title="Notifications"
        description="Les alertes que les sites ouverts peuvent afficher sur le bureau."
        onReset={() => settings.reset("notifications")}
      >
        <NotificationsSection />
      </Section>

      <Section
        id="translate"
        icon="languages"
        title="Traduction"
        description="Traduire les pages avec le service de votre choix : le texte de la page lui est envoyé."
        keywords="translate deepl libretranslate google langue"
        onReset={() => settings.reset("translate")}
      >
        <TranslateSection />
      </Section>

      <Section
        id="assistant"
        icon="sparkles"
        title="Assistant IA"
        description="Résumer, expliquer et interroger les pages avec Claude, avec votre propre clé d'API Anthropic : le texte des pages choisies lui est envoyé."
        keywords="assistant ia ai claude anthropic résumé chat"
        onReset={() => settings.reset("assistant")}
      >
        <AssistantSection />
      </Section>

      <Section
        id="spellcheck"
        icon="spell-check"
        title="Orthographe"
        description="Vérification de l'orthographe dans les champs de texte des pages."
        keywords="correcteur dictionnaire spellcheck"
        onReset={() => settings.reset("spellcheck")}
      >
        <SpellcheckSection />
      </Section>

      <Section
        id="downloads"
        icon="download"
        title="Téléchargements"
        description="Où vont les fichiers, et comment."
        onReset={() => settings.reset("downloads")}
      >
        <DownloadsSection />
      </Section>

      <Section id="data" icon="database" title="Données" description="Historique et favoris, stockés uniquement sur cet appareil.">
        <DataSection />
      </Section>

      <Section
        id="sync"
        icon="cloud"
        title="Synchronisation"
        description="Vos appareils synchronisés, chiffrés de bout en bout : le serveur ne peut rien lire."
      >
        <SyncSection />
      </Section>

      <Section
        id="updates"
        icon="update"
        title="Mises à jour"
        description="Nouvelles versions de Browser, installées au redémarrage."
        onReset={() => settings.reset("updates")}
      >
        <UpdatesSection />
      </Section>

      <Section
        id="diagnostics"
        icon="bug"
        title="Diagnostic"
        description="Rapports de plantage (désactivés par défaut) et signalement des problèmes."
        keywords="crash plantage rapport bug diagnostic"
        onReset={() => settings.reset("diagnostics")}
      >
        <DiagnosticsSection />
      </Section>
    </div>
    <div class="tail" style:height="{tail}px" aria-hidden="true"></div>
  </div>
</div>

<style>
  /* A row reached from the universal bar (deep link): a brief accent wash. */
  .settings :global([data-flash]) {
    border-radius: 12px;
    animation: flash 1.6s var(--ease);
  }
  @keyframes flash {
    0%,
    40% {
      background: color-mix(in oklab, var(--accent) 18%, transparent);
    }
  }
  /*
   * Layout: section navigation on the left, one column of sections (--page-max) on the right.
   * Container query on the page (it lives in the viewport or a split pane, not the window): the
   * navigation shrinks to an icon rail on a medium page, and hides on a narrow one.
   */
  .settings {
    container: settings-page / inline-size;
    display: flex;
    height: 100%;
    animation: rise var(--motion-base) var(--ease);
  }
  .toc {
    display: flex;
    flex: none;
    flex-direction: column;
    gap: 2px;
    width: 216px;
    padding: var(--space-6) var(--space-3) var(--space-4);
    overflow-y: auto;
    border-right: 1px solid var(--border);
  }
  .toc button {
    display: flex;
    flex: none;
    align-items: center;
    gap: 10px;
    height: 34px;
    padding: 0 10px;
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    text-align: left;
    white-space: nowrap;
    transition:
      background var(--motion-fast) var(--ease),
      color var(--motion-fast) var(--ease),
      opacity var(--motion-fast) var(--ease);
  }
  .toc button:hover {
    background: var(--surface-hover);
    color: var(--text);
  }
  .toc button.current {
    background: color-mix(in oklab, var(--accent) 14%, transparent);
    color: var(--text);
    font-weight: 500;
  }
  .toc button.current :global(svg) {
    color: var(--accent-text);
  }
  .toc button.dim {
    opacity: 0.4;
  }
  .reset-all {
    display: flex;
    margin-top: auto;
    padding-top: var(--space-3);
  }
  .content {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    scrollbar-gutter: stable;
  }
  .inner {
    container: settings / inline-size;
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    max-width: var(--page-max);
    margin: 0 auto;
    padding: var(--space-6) var(--space-6) 64px;
    user-select: none;
  }
  .top {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3) var(--space-4);
    margin-bottom: calc(var(--space-2) - var(--space-6));
  }
  h1 {
    flex: 1 1 auto;
    margin: 0;
    font-size: var(--text-xl);
    font-weight: 650;
    letter-spacing: -0.03em;
    line-height: 1.2;
  }
  .search {
    flex: 0 1 280px;
    min-width: 200px;
  }
  @container settings-page (max-width: 760px) {
    .toc {
      width: 60px;
      padding-inline: var(--space-2);
      align-items: center;
    }
    .toc button {
      justify-content: center;
      width: 40px;
      padding: 0;
    }
    .toc-label {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }
    .reset-all :global(button) {
      width: 40px;
      justify-content: center;
      padding: 0;
    }
  }
  @container settings-page (max-width: 440px) {
    .toc {
      display: none;
    }
  }
  @container settings (max-width: 520px) {
    .inner {
      padding-inline: var(--space-4);
    }
    .search {
      flex: 1 1 100%;
    }
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
  }
</style>
