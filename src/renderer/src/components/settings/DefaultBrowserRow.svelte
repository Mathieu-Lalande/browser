<script lang="ts">
  import type { DefaultBrowserStatus } from "@shared/default-browser";
  import { api } from "../../lib/browser.svelte";
  import Icon from "../Icon.svelte";
  import Button from "../ui/Button.svelte";
  import Row from "../ui/Row.svelte";

  /** Settings > Comportement: "Navigateur par défaut" (ADR-039). */

  let status = $state<DefaultBrowserStatus | null>(null);

  $effect(() => {
    void api.defaultBrowser.status().then((current) => (status = current), () => {});
  });

  async function makeDefault(): Promise<void> {
    status = await api.defaultBrowser.makeDefault().catch(() => status);
  }

  const hint = $derived(
    status?.message ?? (status?.state === "default" ? "Les liens ouverts depuis d'autres applications s'ouvrent ici." : "Ouvrir ici les liens des autres applications, et les fichiers HTML et PDF."),
  );
</script>

<Row anchor="default-browser" label="Navigateur par défaut" {hint} keywords="défaut default liens http pdf html associer">
  {#if status?.state === "default"}
    <span class="done" data-testid="default-browser-state"><Icon name="badge-check" size={14} /> Navigateur par défaut</span>
  {:else}
    <Button icon="badge-check" disabled={status?.state !== "not-default"} onclick={makeDefault}>Définir par défaut</Button>
  {/if}
</Row>

<style>
  .done {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--text-muted);
    font-size: var(--text-sm);
  }
</style>
