<script lang="ts">
  import { displayUrl } from "@shared/url";
  import { api, browser } from "../../lib/browser.svelte";
  import { sync } from "../../lib/sync.svelte";
  import Icon from "../Icon.svelte";
  import QrCode from "./QrCode.svelte";
  import Row from "./Row.svelte";

  /**
   * Sync settings (ADR-019): set up an account on a self-hosted relay or pair with a code, then
   * status, devices and their tabs, pairing code (on request, behind a warning), disconnect, reset.
   */

  const status = $derived(sync.status);
  let serverUrl = $state("");
  let secret = $state("");
  let code = $state("");
  let busy = $state(false);
  let message = $state<string | null>(null);
  /** Pairing code: hidden until asked for, then a warning, then shown. */
  let reveal = $state<"hidden" | "warning" | "shown">("hidden");
  let pairingCode = $state<string | null>(null);
  let copied = $state(false);
  let confirming = $state<"disconnect" | "reset" | null>(null);
  let confirmTimer: ReturnType<typeof setTimeout> | undefined;
  let now = $state(Date.now());

  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 15_000);
    return () => {
      clearInterval(timer);
      clearTimeout(confirmTimer);
    };
  });

  // Never leave the pairing code on screen once sync is turned off.
  $effect(() => {
    if (!status?.configured) {
      reveal = "hidden";
      pairingCode = null;
    }
  });

  function ago(time: number | null): string {
    if (!time) return "jamais";
    const seconds = Math.max(0, Math.round((now - time) / 1000));
    if (seconds < 45) return "à l'instant";
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `il y a ${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `il y a ${hours} h`;
    return new Date(time).toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
  }

  const statusText = $derived.by(() => {
    if (!status) return "";
    switch (status.phase) {
      case "syncing":
        return "Synchronisation en cours…";
      case "offline":
        return `Serveur injoignable${status.retryAt ? `, nouvel essai à ${new Date(status.retryAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : ""}.`;
      case "error":
        return status.error?.message ?? "Erreur de synchronisation.";
      default:
        return `Synchronisé ${ago(status.lastSync)}.`;
    }
  });

  async function run(action: () => Promise<{ ok: true } | { ok: false; message: string }>): Promise<boolean> {
    busy = true;
    message = null;
    try {
      const result = await action();
      if (!result.ok) message = result.message;
      return result.ok;
    } catch {
      message = "Action refusée.";
      return false;
    } finally {
      busy = false;
    }
  }

  async function create(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (await run(() => api.sync.createAccount(serverUrl.trim(), secret.trim() || undefined))) {
      serverUrl = "";
      secret = "";
    }
  }

  async function pair(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (await run(() => api.sync.pair(code.trim()))) code = "";
  }

  async function showCode(): Promise<void> {
    pairingCode = await api.sync.pairingCode().catch(() => null);
    reveal = pairingCode ? "shown" : "hidden";
  }

  function hideCode(): void {
    reveal = "hidden";
    pairingCode = null;
    copied = false;
  }

  async function copyCode(): Promise<void> {
    if (!pairingCode) return;
    await navigator.clipboard.writeText(pairingCode).then(() => (copied = true), () => {});
  }

  async function confirmed(kind: "disconnect" | "reset"): Promise<void> {
    if (confirming !== kind) {
      confirming = kind;
      clearTimeout(confirmTimer);
      confirmTimer = setTimeout(() => (confirming = null), 4000);
      return;
    }
    clearTimeout(confirmTimer);
    confirming = null;
    hideCode();
    await run(() => (kind === "reset" ? api.sync.reset() : api.sync.disconnect()));
  }
</script>

{#if browser.isPrivate}
  <Row label="Fenêtre privée" hint="Rien de ce que vous faites dans une fenêtre privée n'est synchronisé. Gérez la synchronisation depuis une fenêtre normale.">
    <Icon name="mask" size={16} />
  </Row>
{:else if !status?.configured}
  <Row
    label="Synchroniser vos appareils"
    hint="Favoris, historique récent, onglets ouverts, espaces et thème entre ce PC et votre téléphone. Tout est chiffré sur l'appareil avant l'envoi : le serveur, que vous hébergez vous-même, ne voit que des données illisibles."
  >
    <Icon name="cloud-off" size={18} />
  </Row>
  <Row label="Premier appareil" hint="Adresse de votre serveur de synchronisation (https). Une nouvelle clé de chiffrement est créée sur cet appareil." stacked>
    <form class="form" onsubmit={create}>
      <input
        class="field"
        type="url"
        bind:value={serverUrl}
        placeholder="https://sync.exemple.fr"
        aria-label="Adresse du serveur de synchronisation"
        spellcheck="false"
        autocomplete="off"
        required
      />
      <input
        class="field small"
        type="password"
        bind:value={secret}
        placeholder="Code d'inscription (facultatif)"
        aria-label="Code d'inscription du serveur"
        autocomplete="off"
      />
      <button class="primary" type="submit" disabled={busy || !serverUrl.trim()}>
        <Icon name="cloud" size={13} /> Activer la synchronisation
      </button>
    </form>
  </Row>
  <Row label="Rejoindre un compte existant" hint="Collez le code de jumelage affiché par un appareil déjà synchronisé (Paramètres, Synchronisation)." stacked>
    <form class="form" onsubmit={pair}>
      <textarea class="field code" bind:value={code} rows="2" placeholder="browser-sync:1:…" aria-label="Code de jumelage" spellcheck="false" required></textarea>
      <button class="primary" type="submit" disabled={busy || !code.trim()}>
        <Icon name="qr" size={13} /> Jumeler cet appareil
      </button>
    </form>
  </Row>
{:else}
  <Row label="État" hint={statusText}>
    <span class="phase" class:error={status.phase === "error"} class:offline={status.phase === "offline"} data-phase={status.phase}>
      <Icon name={status.phase === "offline" || status.phase === "error" ? "cloud-off" : "cloud"} size={14} />
      {status.phase === "syncing" ? "En cours" : status.phase === "idle" ? "Activée" : status.phase === "offline" ? "Hors ligne" : "Erreur"}
    </span>
    <button class="secondary" onclick={() => api.sync.syncNow()} disabled={status.phase === "syncing"}>
      <Icon name="reload" size={13} /> Synchroniser maintenant
    </button>
  </Row>
  <Row label="Cet appareil" hint={`${status.deviceName} · serveur ${status.serverUrl?.replace(/^https?:\/\//, "")} · clé ${status.keyFingerprint}`}>
    <Icon name="laptop" size={16} />
  </Row>
  <Row
    label="Onglets de mes autres appareils"
    hint={status.devices.length ? undefined : "Aucun autre appareil pour l'instant : jumelez votre téléphone avec le code ci-dessous."}
    stacked={status.devices.length > 0}
  >
    {#if status.devices.length}
      <ul class="devices" aria-label="Autres appareils">
        {#each status.devices as device (device.id)}
          <li class="device">
            <div class="device-head">
              <Icon name={device.kind === "mobile" ? "smartphone" : "laptop"} size={15} />
              <span class="device-name">{device.name}</span>
              <span class="device-time">{device.tabs.length} onglet{device.tabs.length > 1 ? "s" : ""} · {ago(device.updatedAt)}</span>
            </div>
            {#each device.tabs as tab (tab.url)}
              <button class="remote-tab" title={tab.url} onclick={() => api.tabs.create(tab.url)}>
                <span class="tab-title">{tab.title || displayUrl(tab.url)}</span>
                <span class="tab-url">{displayUrl(tab.url)}</span>
              </button>
            {/each}
          </li>
        {/each}
      </ul>
    {/if}
  </Row>
  <Row
    label="Ajouter un appareil"
    hint={reveal === "shown"
      ? "Sur le téléphone : Paramètres, Synchroniser, Scanner. Sur un autre PC : collez le code."
      : "Affiche le QR code et le code de jumelage à scanner ou coller sur l'autre appareil."}
    stacked={reveal !== "hidden"}
  >
    {#if reveal === "hidden"}
      <button class="secondary" onclick={() => (reveal = "warning")}><Icon name="qr" size={13} /> Afficher le code de jumelage</button>
    {:else if reveal === "warning"}
      <div class="warning" role="alert">
        <Icon name="warning" size={16} />
        <p>
          Ce code donne un <strong>accès complet</strong> à vos données synchronisées (favoris, historique, onglets) à quiconque le voit.
          Ne l'affichez pas pendant un partage d'écran et ne l'envoyez à personne.
        </p>
        <div class="buttons">
          <button class="secondary" onclick={hideCode}>Annuler</button>
          <button class="primary" onclick={showCode}>Afficher le code</button>
        </div>
      </div>
    {:else if pairingCode}
      <div class="pairing">
        <QrCode value={pairingCode} size={196} label="QR code de jumelage" />
        <div class="pairing-side">
          <textarea class="field code" readonly rows="4" aria-label="Code de jumelage" value={pairingCode}></textarea>
          <div class="buttons">
            <button class="secondary" onclick={copyCode}><Icon name={copied ? "check" : "duplicate"} size={13} /> {copied ? "Copié" : "Copier le code"}</button>
            <button class="secondary" onclick={hideCode}>Masquer</button>
          </div>
        </div>
      </div>
    {/if}
  </Row>
  <Row label="Déconnecter cet appareil" hint="Arrête la synchronisation ici et retire cet appareil de la liste. Les données restent sur l'appareil.">
    <button class="danger" class:confirming={confirming === "disconnect"} disabled={busy} onclick={() => confirmed("disconnect")}>
      <Icon name="unlink" size={13} />
      {confirming === "disconnect" ? "Confirmer" : "Déconnecter"}
    </button>
  </Row>
  <Row
    label="Réinitialiser la synchronisation"
    hint="Efface toutes les données du serveur et crée une nouvelle clé. Les autres appareils sont déconnectés et devront être jumelés à nouveau."
  >
    <button class="danger" class:confirming={confirming === "reset"} disabled={busy} onclick={() => confirmed("reset")}>
      <Icon name="key" size={13} />
      {confirming === "reset" ? "Confirmer la réinitialisation" : "Réinitialiser"}
    </button>
  </Row>
{/if}
{#if message}
  <p class="message" role="alert"><Icon name="warning" size={13} /> {message}</p>
{/if}

<style>
  .form {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 8px;
    width: 100%;
  }
  .field {
    flex: 1 1 240px;
    min-width: 0;
    height: 32px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    outline: 0;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    user-select: text;
  }
  .field.small {
    flex: 0 1 220px;
  }
  .field.code {
    height: auto;
    padding: 8px 10px;
    font: 11.5px/1.45 ui-monospace, monospace;
    resize: none;
    word-break: break-all;
  }
  .field:focus {
    border-color: color-mix(in oklab, var(--accent) 60%, transparent);
    box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent) 18%, transparent);
  }
  .primary,
  .secondary,
  .danger {
    display: flex;
    flex: none;
    align-items: center;
    gap: 7px;
    height: 32px;
    padding: 0 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    white-space: nowrap;
  }
  .primary {
    border-color: transparent;
    background: var(--accent);
    color: var(--on-accent, #fff);
  }
  .secondary:hover,
  .danger:hover {
    background: var(--surface-hover);
  }
  .danger.confirming {
    border-color: transparent;
    background: #e5484d;
    color: #fff;
  }
  button:disabled {
    opacity: 0.55;
  }
  .phase {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--accent-text);
    font-size: 12px;
  }
  .phase.offline,
  .phase.error {
    color: #e5484d;
  }
  .devices {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .device {
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-elevated);
  }
  .device-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 2px 4px 6px;
    color: var(--text-muted);
  }
  .device-name {
    flex: 1;
    color: var(--text);
    font-weight: 500;
  }
  .device-time {
    font-size: 11.5px;
  }
  .remote-tab {
    display: flex;
    flex-direction: column;
    width: 100%;
    padding: 5px 8px;
    border-radius: 7px;
    text-align: left;
  }
  .remote-tab:hover {
    background: var(--surface-hover);
  }
  .tab-title,
  .tab-url {
    max-width: 100%;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .tab-url {
    color: var(--text-faint);
    font-size: 11px;
  }
  .warning {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 10px;
    padding: 12px;
    border: 1px solid color-mix(in oklab, #e5484d 45%, transparent);
    border-radius: var(--radius);
    background: color-mix(in oklab, #e5484d 9%, transparent);
    color: var(--text);
  }
  .warning p {
    flex: 1 1 300px;
    margin: 0;
    line-height: 1.5;
  }
  .buttons {
    display: flex;
    gap: 8px;
  }
  .pairing {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
  }
  .pairing-side {
    display: flex;
    flex: 1 1 260px;
    flex-direction: column;
    gap: 8px;
  }
  .message {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    padding: 10px 18px 14px;
    color: #e5484d;
    font-size: 12px;
  }
</style>
