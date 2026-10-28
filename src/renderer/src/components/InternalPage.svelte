<script lang="ts">
  import type { InternalPage } from "@shared/internal";
  import ArchivePage from "./folders/ArchivePage.svelte";
  import BoostsPage from "./boosts/BoostsPage.svelte";
  import DownloadsPage from "./downloads/DownloadsPage.svelte";
  import ExtensionsPage from "./extensions/ExtensionsPage.svelte";
  import PasswordsPage from "./passwords/PasswordsPage.svelte";
  import SettingsPage from "./settings/SettingsPage.svelte";

  /** A `browser://` page drawn by the chrome (ADR-012), in the viewport or in a split pane. */
  let { page }: { page: InternalPage } = $props();
</script>

{#if page === "settings"}
  <SettingsPage />
{:else if page === "downloads"}
  <DownloadsPage />
{:else if page === "archive"}
  <ArchivePage />
{:else if page === "extensions"}
  <ExtensionsPage />
{:else if page === "passwords"}
  <PasswordsPage />
{:else if page === "boosts"}
  <BoostsPage />
{/if}
