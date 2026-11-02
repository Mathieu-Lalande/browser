<script lang="ts">
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
    result = await api.translate.setKey(id, value).catch(() => ({ ok: false, message: "La clé n'a pas été enregistrée." }));
    busy = false;
    if (result.ok) keyDraft = "";
    await refreshKeys();
  }

  function saveServer(): void {
    const url = serverDraft.trim() ? normalizeServerUrl(serverDraft) : "";
    if (url === null) return void (result = { ok: false, message: "Adresse invalide (http:// ou https://, sans identifiants)." });
    settings.update({ translate: { libreUrl: url } });
    serverDraft = url;
    result = { ok: true, message: "Adresse enregistrée." };
  }

  async function test(): Promise<void> {
    busy = true;
    result = await api.translate.test().catch(() => ({ ok: false, message: "Le test a échoué." }));
    busy = false;
  }

  const setRules = (patch: Partial<Pick<typeof t, "alwaysLanguages" | "neverLanguages" | "neverSites">>) => settings.update({ translate: patch });
</script>

<Row
  anchor="provider"
  label="Service de traduction"
  id="translate-provider"
  hint="Désactivée par défaut. Pour traduire, le texte de la page est envoyé au service choisi (jamais les mots de passe ni les champs de formulaire) : une confirmation est demandée la première fois, et à chaque session en navigation privée."
  keywords="deepl libretranslate google langue confidentialité"
>
  <select
    id="translate-provider"
    class="ui-field"
    value={t.provider}
    onchange={(event) => settings.update({ translate: { provider: event.currentTarget.value as TranslateProviderChoice } })}
  >
    <option value="none">Désactivée</option>
    {#each TRANSLATE_PROVIDERS as entry (entry.id)}
      <option value={entry.id}>{entry.label}</option>
    {/each}
  </select>
</Row>

{#if provider === "deepl"}
  <Row anchor="deepl-plan" label="Formule DeepL" hint="DeepL API Free (clés finissant par « :fx ») ou Pro.">
    <Segmented
      label="Formule DeepL"
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
    label="Serveur LibreTranslate"
    id="translate-server"
    hint={t.libreUrl && isPlainHttp(t.libreUrl) ? "Connexion non chiffrée (http) : à réserver à un serveur de votre réseau local." : "Votre propre serveur ou un serveur public, par exemple https://libretranslate.com."}
  >
    <input id="translate-server" class="ui-field wide" type="url" placeholder="https://…" bind:value={serverDraft} spellcheck="false" />
    <Button onclick={saveServer} disabled={serverDraft.trim() === t.libreUrl}>Enregistrer</Button>
  </Row>
{/if}

{#if provider}
  <Row
    anchor="api-key"
    label={needsKey ? "Clé d'API" : "Clé d'API (facultative)"}
    id="translate-key"
    hint={browser.isPrivate
      ? "Indisponible en navigation privée."
      : keys && !keys.available
        ? (keys.message ?? undefined)
        : hasKey
          ? "Clé enregistrée, chiffrée par le système. Saisissez-en une autre pour la remplacer."
          : "Chiffrée par le système et gardée sur cet appareil ; elle n'est jamais réaffichée."}
  >
    {#if hasKey && !browser.isPrivate}
      <IconButton icon="trash" size="row" label="Supprimer la clé" onclick={() => saveKey(provider, "")} />
    {/if}
    <input
      id="translate-key"
      class="ui-field"
      type="password"
      autocomplete="off"
      placeholder={hasKey ? "••••••••" : "Clé"}
      bind:value={keyDraft}
      disabled={browser.isPrivate || keys?.available === false}
    />
    <Button onclick={() => saveKey(provider, keyDraft)} disabled={busy || !keyDraft.trim() || browser.isPrivate}>Enregistrer</Button>
  </Row>

  <Row anchor="test" label="Tester le service" hint="Traduit une courte phrase d'exemple avec la configuration actuelle.">
    {#if result}
      <span class="result" class:error={!result.ok} role="status"><Icon name={result.ok ? "check" : "warning"} size={12} /> {result.message}</span>
    {/if}
    <Button icon="languages" onclick={test} disabled={busy}>Tester</Button>
  </Row>
{/if}

<Row anchor="target" label="Traduire vers" id="translate-target" hint="Par défaut, la langue du système.">
  <select id="translate-target" class="ui-field" value={t.target} onchange={(event) => settings.update({ translate: { target: event.currentTarget.value } })}>
    <option value="">Langue du système</option>
    {#each LANGUAGES as language (language.code)}
      <option value={language.code}>{language.name}</option>
    {/each}
  </select>
</Row>

<Row anchor="offer" label="Proposer de traduire" hint="Le bouton de traduction apparaît dans la barre d'adresse sur les pages dans une autre langue.">
  <Toggle label="Proposer de traduire" checked={t.offer} onchange={(offer) => settings.update({ translate: { offer } })} />
</Row>

{#snippet ruleList(title: string, hint: string, items: string[], label: (item: string) => string, remove: (item: string) => void)}
  {#if items.length}
    <Row label={title} {hint} stacked>
      <ul class="list" aria-label={title}>
        {#each items as item (item)}
          <li>
            <span>{label(item)}</span>
            <IconButton icon="close" size="row" label="Retirer {label(item)}" onclick={() => remove(item)} />
          </li>
        {/each}
      </ul>
    </Row>
  {/if}
{/snippet}

{@render ruleList("Toujours traduire", "Langues traduites dès l'ouverture de la page.", t.alwaysLanguages, languageName, (code) =>
  setRules({ alwaysLanguages: t.alwaysLanguages.filter((item) => item !== code) }),
)}
{@render ruleList("Ne jamais traduire", "Langues pour lesquelles la traduction n'est pas proposée.", t.neverLanguages, languageName, (code) =>
  setRules({ neverLanguages: t.neverLanguages.filter((item) => item !== code) }),
)}
{@render ruleList("Jamais pour ces sites", "Sites (et leurs sous-domaines) où la traduction n'est jamais proposée.", t.neverSites, (site) => site, (site) =>
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
