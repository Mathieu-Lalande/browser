<script lang="ts">
  import { ASSISTANT_MODELS, PRIVACY_NOTICE, type AssistantKeyStatus, type AssistantModelId } from "@shared/assistant";
  import { api, browser } from "../../lib/browser.svelte";
  import { platform } from "../../lib/platform.svelte";
  import { settings } from "../../lib/settings.svelte";
  import Icon from "../Icon.svelte";
  import Button from "../ui/Button.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import Row from "../ui/Row.svelte";
  import Toggle from "../ui/Toggle.svelte";

  /**
   * "Assistant IA" (ADR-044): off by default; the user's own Anthropic API key (saved by main in
   * the OS keychain, never shown again, never synced), the model, a test, and what is sent.
   */
  const a = $derived(settings.current.assistant);

  let key = $state<AssistantKeyStatus | null>(null);
  let draft = $state("");
  let result = $state<{ ok: boolean; message: string } | null>(null);
  let busy = $state(false);

  const refreshKey = () => api.assistant.key().then((next) => (key = next), () => null);
  $effect(() => void refreshKey());

  async function saveKey(value: string): Promise<void> {
    busy = true;
    result = await api.assistant.setKey(value).catch(() => ({ ok: false, message: "La clé n'a pas été enregistrée." }));
    busy = false;
    if (result.ok) draft = "";
    await refreshKey();
  }

  async function test(): Promise<void> {
    busy = true;
    result = await api.assistant.test().catch(() => ({ ok: false, message: "Le test a échoué." }));
    busy = false;
  }
</script>

<Row anchor="enabled" label="Activer l'assistant" hint={PRIVACY_NOTICE} keywords="ia ai claude anthropic confidentialité">
  <Toggle label="Activer l'assistant" checked={a.enabled} onchange={(enabled) => settings.update({ assistant: { enabled } })} />
</Row>

<Row
  anchor="api-key"
  label="Clé d'API Anthropic"
  id="assistant-key"
  hint={browser.isPrivate
    ? "Indisponible en navigation privée."
    : key && !key.available
      ? (key.message ?? undefined)
      : key?.set
        ? "Clé enregistrée, chiffrée par le système. Saisissez-en une autre pour la remplacer."
        : "Créez-la sur console.anthropic.com. Chiffrée par le système, gardée sur cet appareil, jamais synchronisée ni réaffichée."}
>
  {#if key?.set && !browser.isPrivate}
    <IconButton icon="trash" size="row" label="Supprimer la clé" onclick={() => saveKey("")} />
  {/if}
  <input
    id="assistant-key"
    class="ui-field"
    type="password"
    autocomplete="off"
    spellcheck="false"
    placeholder={key?.set ? "••••••••" : "sk-ant-…"}
    bind:value={draft}
    disabled={browser.isPrivate || key?.available === false}
  />
  <Button onclick={() => saveKey(draft)} disabled={busy || !draft.trim() || browser.isPrivate}>Enregistrer</Button>
</Row>

<Row anchor="model" label="Modèle" id="assistant-model" hint={ASSISTANT_MODELS.find((model) => model.id === a.model)?.hint}>
  <select id="assistant-model" class="ui-field" value={a.model} onchange={(event) => settings.update({ assistant: { model: event.currentTarget.value as AssistantModelId } })}>
    {#each ASSISTANT_MODELS as model (model.id)}
      <option value={model.id}>{model.label}{model.id === "claude-fable-5-1" ? " (plus puissant)" : ""}</option>
    {/each}
  </select>
</Row>

<Row anchor="test" label="Tester la clé" hint="Vérifie la clé et l'accès au modèle, sans consommer de jetons.">
  {#if result}
    <span class="result" class:error={!result.ok} role="status"><Icon name={result.ok ? "check" : "warning"} size={12} /> {result.message}</span>
  {/if}
  <Button icon="sparkles" onclick={test} disabled={busy || !key?.set}>Tester</Button>
</Row>

<Row anchor="include-page" label="Joindre la page aux questions" hint="Par défaut, une question posée dans le panneau ou avec @ia emporte le texte de la page affichée.">
  <Toggle label="Joindre la page aux questions" checked={a.includePage} onchange={(includePage) => settings.update({ assistant: { includePage } })} />
</Row>

<Row
  anchor="keep"
  label="Garder les conversations"
  hint="Par défaut, la conversation d'un onglet s'efface quand il change de page. Elles restent en mémoire dans tous les cas : rien n'est écrit sur le disque ni synchronisé."
>
  <Toggle label="Garder les conversations" checked={a.keepConversations} onchange={(keepConversations) => settings.update({ assistant: { keepConversations } })} />
</Row>

<Row
  anchor="usage"
  label="Utilisation"
  hint="{platform.shortcut('toggle-assistant') ? `Raccourci ${platform.shortcut('toggle-assistant')}, ` : ''}menu « … », clic droit sur la page ou une sélection, ou @ia suivi d'une question dans la barre universelle. Chaque demande est facturée par Anthropic sur votre compte ; les pages longues sont tronquées (c'est indiqué)."
>
  <span></span>
</Row>

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
</style>
