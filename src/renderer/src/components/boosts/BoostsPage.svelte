<script lang="ts">
  import { t } from "@shared/i18n";
  import { DEFAULT_FILTERS, type Boost, type BoostInput } from "@shared/boosts";
  import { api, browser } from "../../lib/browser.svelte";
  import "../../styles/kit.css";
  import Button from "../ui/Button.svelte";
  import Card from "../ui/Card.svelte";
  import EmptyState from "../ui/EmptyState.svelte";
  import Page from "../ui/Page.svelte";
  import BoostEditor from "./BoostEditor.svelte";
  import BoostRow from "./BoostRow.svelte";

  /**
   * `browser://boosts` (ADR-029): every boost, to switch on/off, edit or remove. The editor sends
   * a whole boost; main validates it (pattern, sizes, selectors) and answers with a message to fix.
   * A private window only lists them.
   */

  let boosts = $state<Boost[]>([]);
  let loaded = $state(false);
  /** The boost being edited (a copy), or a new one; null while the editor is closed. */
  let editing = $state<BoostInput | null>(null);
  let request = 0;

  async function refresh(): Promise<void> {
    const id = ++request;
    const list = await api.boosts.list().catch(() => []);
    if (id !== request) return;
    boosts = list;
    loaded = true;
  }

  $effect(() => {
    void refresh();
    return api.boosts.onChanged(() => void refresh());
  });

  const blank = (): BoostInput => ({
    name: "",
    match: "",
    enabled: true,
    css: "",
    zaps: [],
    font: null,
    filters: { ...DEFAULT_FILTERS },
    script: { enabled: false, code: "", allowPrivate: false },
  });

  const edit = (boost: Boost | null) => (editing = boost ? structuredClone($state.snapshot(boost)) : blank());

  async function save(input: BoostInput): Promise<string | null> {
    const result = await api.boosts.save(input).catch(() => ({ ok: false as const, message: t("boostsPage.boostWasntSaved") }));
    if (!result.ok) return result.message;
    editing = null;
    return null;
  }
</script>

{#snippet subtitle()}
  {#if browser.isPrivate}
    {t("boostsPage.boostsAlsoApplyPrivate")}
  {:else}
    {t("boostsPage.customizeSitesColorFilters")}
  {/if}
{/snippet}

<div class="kit">
  <Page icon="rocket" title={t("boostsPage.boosts")} {subtitle} testid="boosts-page">
    {#snippet actions()}
      {#if !browser.isPrivate && !editing}
        <Button variant="primary" icon="plus" onclick={() => edit(null)}>{t("boostsPage.newBoost")}</Button>
      {/if}
    {/snippet}

    {#if editing}
      {#key editing}
        <BoostEditor initial={editing} onsave={save} oncancel={() => (editing = null)} />
      {/key}
    {/if}

    {#if boosts.length}
      <Card as="ul">
        {#each boosts as boost (boost.id)}
          <BoostRow {boost} onedit={edit} />
        {/each}
      </Card>
    {:else if loaded && !editing}
      <EmptyState icon="rocket" title={t("boostsPage.noBoosts")} hint={t("boostsPage.boostChangesHowSite")} />
    {/if}
  </Page>
</div>

<style>
  .kit {
    display: contents;
  }
</style>
