<script lang="ts">
  import { t as tr } from "@shared/i18n";
  import {
    isPlainHttp,
    LANGUAGES,
    languageName,
    normalizeServerUrl,
    TRANSLATE_PROVIDERS,
    type TranslateKeysStatus,
    type TranslateProviderChoice,
    type TranslateProviderId,
  } from "@shared/translate";
  import { api, browser } from "../../lib/browser.svelte";
  import { settings } from "../../lib/settings.svelte";
  import Icon from "../Icon.svelte";
  import Button from "../ui/Button.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import Row from "../ui/Row.svelte";
  import Segmented from "../ui/Segmented.svelte";
  import Toggle from "../ui/Toggle.svelte";

  /**
   * "Traduction" (ADR-036): the provider (off by default: translating sends the page's text to it),
   * its key (saved by main in the OS keychain, never shown again) or server, a test, the target
   * language and the rules made from the popover.
   */
  const t = $derived(settings.current.translate);
  const provider = $derived(t.provider === "none" ? null : t.provider);
  const needsKey = $derived(!!provider && TRANSLATE_PROVIDERS.find((entry) => entry.id === provider)!.needsKey);

  let keys = $state<TranslateKeysStatus | null>(null);
  let keyDraft = $state("");
  let serverDraft = $state("");
  let result = $state<{ ok: boolean; message: string } | null>(null);
  let busy = $state(false);

  const refreshKeys = () => api.translate.keys().then((next) => (keys = next), () => null);
  $effect(() => void refreshKeys());
  // Another provider: drafts and results were about the previous one.
  $effect(() => {
    void provider;
    keyDraft = "";
    serverDraft = t.libreUrl;
    result = null;
  });

  const hasKey = $derived(!!provider && !!keys?.keys[provider]);

  async function saveKey(id: TranslateProviderId, value: string): Promise<void> {
    busy = true;
    result = await api.translate.setKey(id, value).catch(() => ({ ok: false, message: tr("translateSection.keyWasntSaved") }));
    busy = false;
    if (result.ok) keyDraft = "";
    await refreshKeys();
  }

  function saveServer(): void {
    const url = serverDraft.trim() ? normalizeServerUrl(serverDraft) : "";
    if (url === null) return void (result = { ok: false, message: tr("translateSection.invalidAddressHttpHttps") });
    settings.update({ translate: { libreUrl: url } });
    serverDraft = url;
    result = { ok: true, message: tr("translateSection.addressSaved") };
  }

  async function test(): Promise<void> {
    busy = true;
    result = await api.translate.test().catch(() => ({ ok: false, message: tr("translateSection.testFailed") }));
    busy = false;
  }

  const setRules = (patch: Partial<Pick<typeof t, "alwaysLanguages" | "neverLanguages" | "neverSites">>) => settings.update({ translate: patch });
</script>

<Row
  anchor="provider"
  label={tr("translateSection.translationService")}
  id="translate-provider"
  hint={tr("translateSection.offDefaultTranslatePages")}
  keywords={tr("translateSection.deeplLibretranslateGoogleLanguage")}
>
  <select
    id="translate-provider"
    class="ui-field"
    value={t.provider}
    onchange={(event) => settings.update({ translate: { provider: event.currentTarget.value as TranslateProviderChoice } })}
  >
    <option value="none">{tr("translateSection.off")}</option>
    {#each TRANSLATE_PROVIDERS as entry (entry.id)}
      <option value={entry.id}>{entry.label}</option>
    {/each}
  </select>
</Row>

{#if provider === "deepl"}
  <Row anchor="deepl-plan" label={tr("translateSection.deeplPlan")} hint={tr("translateSection.deeplApiFreeKeys")}>
    <Segmented
      label={tr("translateSection.deeplPlan")}
      value={t.deeplPlan}
      options={[
        { value: "free", label: "Free" },
        { value: "pro", label: "Pro" },
      ]}
      onchange={(deeplPlan) => settings.update({ translate: { deeplPlan } })}
    />
  </Row>
{/if}

{#if provider === "libretranslate"}
  <Row
    anchor="server"
    label={tr("translateSection.libretranslateServer")}
    id="translate-server"
    hint={t.libreUrl && isPlainHttp(t.libreUrl) ? tr("translateSection.unencryptedConnectionHttpOnly") : tr("translateSection.ownServerPublicOne")}
  >
    <input id="translate-server" class="ui-field wide" type="url" placeholder="https://…" bind:value={serverDraft} spellcheck="false" />
    <Button onclick={saveServer} disabled={serverDraft.trim() === t.libreUrl}>{tr("translateSection.save")}</Button>
  </Row>
{/if}

{#if provider}
  <Row
    anchor="api-key"
    label={needsKey ? tr("translateSection.apiKey") : tr("translateSection.apiKeyOptional")}
    id="translate-key"
    hint={browser.isPrivate
      ? tr("translateSection.unavailablePrivateBrowsing")
      : keys && !keys.available
        ? (keys.message ?? undefined)
        : hasKey
          ? tr("translateSection.keySavedEncryptedSystem")
          : tr("translateSection.encryptedSystemKeptDevice")}
  >
    {#if hasKey && !browser.isPrivate}
      <IconButton icon="trash" size="row" label={tr("translateSection.deleteKey")} onclick={() => saveKey(provider, "")} />
    {/if}
    <input
      id="translate-key"
      class="ui-field"
      type="password"
      autocomplete="off"
      placeholder={hasKey ? "••••••••" : tr("translateSection.key")}
      bind:value={keyDraft}
      disabled={browser.isPrivate || keys?.available === false}
    />
    <Button onclick={() => saveKey(provider, keyDraft)} disabled={busy || !keyDraft.trim() || browser.isPrivate}>{tr("translateSection.save")}</Button>
  </Row>

  <Row anchor="test" label={tr("translateSection.testService")} hint={tr("translateSection.translatesShortSampleSentence")}>
    {#if result}
      <span class="result" class:error={!result.ok} role="status"><Icon name={result.ok ? "check" : "warning"} size={12} /> {result.message}</span>
    {/if}
    <Button icon="languages" onclick={test} disabled={busy}>{tr("translateSection.test")}</Button>
  </Row>
{/if}

<Row anchor="target" label={tr("translateSection.translate")} id="translate-target" hint={tr("translateSection.defaultSystemLanguage")}>
  <select id="translate-target" class="ui-field" value={t.target} onchange={(event) => settings.update({ translate: { target: event.currentTarget.value } })}>
    <option value="">{tr("translateSection.systemLanguage")}</option>
    {#each LANGUAGES as language (language.code)}
      <option value={language.code}>{language.name}</option>
    {/each}
  </select>
</Row>

<Row anchor="offer" label={tr("translateSection.offerTranslate")} hint={tr("translateSection.translateButtonAppearsAddress")}>
  <Toggle label={tr("translateSection.offerTranslate")} checked={t.offer} onchange={(offer) => settings.update({ translate: { offer } })} />
</Row>

{#snippet ruleList(title: string, hint: string, items: string[], label: (item: string) => string, remove: (item: string) => void)}
  {#if items.length}
    <Row label={title} {hint} stacked>
      <ul class="list" aria-label={title}>
        {#each items as item (item)}
          <li>
            <span>{label(item)}</span>
            <IconButton icon="close" size="row" label={tr("translateSection.remove", { p: label(item) })} onclick={() => remove(item)} />
          </li>
        {/each}
      </ul>
    </Row>
  {/if}
{/snippet}

{@render ruleList(tr("translateSection.alwaysTranslate"), tr("translateSection.languagesTranslatedSoonPage"), t.alwaysLanguages, languageName, (code) =>
  setRules({ alwaysLanguages: t.alwaysLanguages.filter((item) => item !== code) }),
)}
{@render ruleList(tr("translateSection.neverTranslate"), tr("translateSection.languagesWhichTranslationIsnt"), t.neverLanguages, languageName, (code) =>
  setRules({ neverLanguages: t.neverLanguages.filter((item) => item !== code) }),
)}
{@render ruleList(tr("translateSection.neverTheseSites"), tr("translateSection.sitesTheirSubdomainsWhere"), t.neverSites, (site) => site, (site) =>
  setRules({ neverSites: t.neverSites.filter((item) => item !== site) }),
)}

<style>
  .result {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    max-width: 260px;
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
  .result.error {
    color: var(--danger);
  }
  .ui-field {
    width: 200px;
  }
  .ui-field.wide {
    width: min(280px, 100%);
  }
  .list {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .list li {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding-left: var(--space-3);
    border-radius: var(--radius-pill);
    background: var(--surface);
    font-size: var(--text-xs);
  }
</style>
