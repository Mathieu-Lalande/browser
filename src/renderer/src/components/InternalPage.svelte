<script lang="ts">
  import type { Component } from "svelte";
  import type { InternalPage } from "@shared/internal";

  /**
   * A `browser://` page drawn by the chrome (ADR-012), in the viewport or in a split pane. Each page
   * is its own chunk, loaded the first time it is shown (ADR-043): the chrome UI's first paint does
   * not wait for the settings, passwords, history… code. A chunk is local (app://), so the wait is
   * a few milliseconds, once.
   */
  let { page }: { page: InternalPage } = $props();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Loader = () => Promise<{ default: Component<any> }>;
  const PAGES: Record<InternalPage, Loader> = {
    settings: () => import("./settings/SettingsPage.svelte"),
    downloads: () => import("./downloads/DownloadsPage.svelte"),
    archive: () => import("./folders/ArchivePage.svelte"),
    extensions: () => import("./extensions/ExtensionsPage.svelte"),
    passwords: () => import("./passwords/PasswordsPage.svelte"),
    boosts: () => import("./boosts/BoostsPage.svelte"),
    notes: () => import("./annotations/NotesPage.svelte"),
    history: () => import("./history/HistoryPage.svelte"),
    import: () => import("./import/ImportPage.svelte"),
    tasks: () => import("./tasks/TasksPage.svelte"),
    profiles: () => import("./profiles/ProfilesPage.svelte"),
    welcome: () => import("./welcome/WelcomePage.svelte"),
    privacy: () => import("./privacy/PrivacyDashboard.svelte"),
    "site-settings": () => import("./privacy/SiteSettingsPage.svelte"),
    "reading-list": () => import("./reading/ReadingListPage.svelte"),
  };

  /** Loaded pages, so that coming back to one renders it at once (no {#await} gap). */
  const loaded = $state<Partial<Record<InternalPage, Component>>>({});

  $effect(() => {
    const name = page;
    if (!loaded[name]) void PAGES[name]().then((module) => (loaded[name] = module.default));
  });

  const Current = $derived(loaded[page]);
</script>

{#if Current}
  <Current />
{/if}
