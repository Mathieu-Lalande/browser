<script lang="ts">
  import { DOH_PROVIDERS, normalizeDohTemplate, normalizeNextDnsId, type SecureDnsChoice } from "@shared/secure-dns";
  import { settings } from "../../lib/settings.svelte";
  import Row from "../ui/Row.svelte";

  /** Settings > Confidentialité: secure DNS (DNS over HTTPS, ADR-046), applied at once to the whole app. */

  const p = $derived(settings.current.privacy);
  const CHOICES: { value: SecureDnsChoice; label: string }[] = [
    { value: "automatic", label: "Automatique (selon le fournisseur d'accès)" },
    { value: "off", label: "Désactivé (DNS du système)" },
    { value: "cloudflare", label: DOH_PROVIDERS.cloudflare.label },
    { value: "quad9", label: DOH_PROVIDERS.quad9.label },
    { value: "nextdns", label: DOH_PROVIDERS.nextdns.label },
    { value: "custom", label: "Personnalisé…" },
  ];

  let customDraft = $state<string | null>(null);
  let nextDnsDraft = $state<string | null>(null);
  const customValue = $derived(customDraft ?? p.secureDnsCustomUrl);
  const customInvalid = $derived(customValue.trim() !== "" && !normalizeDohTemplate(customValue));
  const nextDnsValue = $derived(nextDnsDraft ?? p.secureDnsNextDnsId);
  const nextDnsInvalid = $derived(nextDnsValue.trim() !== "" && !normalizeNextDnsId(nextDnsValue));

  function saveCustom(): void {
    const template = customValue.trim() === "" ? "" : normalizeDohTemplate(customValue);
    if (template === null) return;
    customDraft = null;
    settings.update({ privacy: { secureDnsCustomUrl: template } });
  }

  function saveNextDns(): void {
    const id = nextDnsValue.trim() === "" ? "" : normalizeNextDnsId(nextDnsValue);
    if (id === null) return;
    nextDnsDraft = null;
    settings.update({ privacy: { secureDnsNextDnsId: id } });
  }

  const hint = $derived(
    p.secureDns === "custom" && customInvalid
      ? "Adresse invalide : un modèle https:// (RFC 8484), par exemple https://dns.exemple.fr/dns-query."
      : p.secureDns === "custom" && !normalizeDohTemplate(p.secureDnsCustomUrl)
        ? "Tant qu'aucune adresse valide n'est saisie, le mode automatique s'applique."
        : "Chiffre les requêtes DNS vers le fournisseur choisi, pour tout le navigateur. Les entreprises et contrôles parentaux qui filtrent le DNS du système ne s'appliquent plus.",
  );
</script>

<Row anchor="secure-dns" label="DNS sécurisé" {hint} id="secure-dns" stacked>
  <div class="fields">
    <select
      id="secure-dns"
      class="ui-field"
      value={p.secureDns}
      onchange={(event) => settings.update({ privacy: { secureDns: event.currentTarget.value as SecureDnsChoice } })}
    >
      {#each CHOICES as choice (choice.value)}
        <option value={choice.value}>{choice.label}</option>
      {/each}
    </select>
    {#if p.secureDns === "custom"}
      <input
        class="ui-field"
        class:invalid={customInvalid}
        aria-label="Adresse du serveur DNS over HTTPS"
        aria-invalid={customInvalid}
        placeholder="https://dns.exemple.fr/dns-query"
        value={customValue}
        oninput={(event) => (customDraft = event.currentTarget.value)}
        onchange={saveCustom}
      />
    {:else if p.secureDns === "nextdns"}
      <input
        class="ui-field"
        class:invalid={nextDnsInvalid}
        aria-label="Identifiant de configuration NextDNS (facultatif)"
        aria-invalid={nextDnsInvalid}
        placeholder="Identifiant (facultatif)"
        value={nextDnsValue}
        oninput={(event) => (nextDnsDraft = event.currentTarget.value)}
        onchange={saveNextDns}
      />
    {/if}
  </div>
</Row>

<style>
  .fields {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .fields > * {
    flex: 1 1 220px;
  }
  .invalid {
    border-color: var(--danger);
  }
</style>
