<script lang="ts">
  import { t as tr, t, intlLocale, formatTime } from "@shared/i18n";
  import { displayUrl } from "@shared/url";
  import { api, browser } from "../../lib/browser.svelte";
  import { sync } from "../../lib/sync.svelte";
  import Icon from "../Icon.svelte";
  import QrCode from "./QrCode.svelte";
  import Row from "../ui/Row.svelte";
  import Toggle from "../ui/Toggle.svelte";
  import { settings } from "../../lib/settings.svelte";

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
  /** Two-step confirmation: "disconnect", "reset", or `revoke:<device id>` (ADR-056). */
  let confirming = $state<string | null>(null);
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
    if (!time) return t("syncSection.never");
    const seconds = Math.max(0, Math.round((now - time) / 1000));
    if (seconds < 45) return t("syncSection.justNow");
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return t("syncSection.minAgo", { minutes });
    const hours = Math.round(minutes / 60);
    if (hours < 24) return t("syncSection.hAgo", { hours });
    return new Date(time).toLocaleDateString(intlLocale(), { day: "numeric", month: "long" });
  }

  const statusText = $derived.by(() => {
    if (!status) return "";
    switch (status.phase) {
      case "syncing":
        return t("syncSection.syncing");
      case "offline":
        return status.retryAt ? t("syncSection.offlineRetryAt", { time: formatTime(status.retryAt) }) : t("syncSection.offline");
      case "error":
        return status.error?.message ?? t("syncSection.syncError");
      default:
        return t("syncSection.synced", { p: ago(status.lastSync) });
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
      message = t("syncSection.actionRefused");
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

  async function confirmed(kind: string): Promise<void> {
    if (confirming !== kind) {
      confirming = kind;
      clearTimeout(confirmTimer);
      confirmTimer = setTimeout(() => (confirming = null), 4000);
      return;
    }
    clearTimeout(confirmTimer);
    confirming = null;
    hideCode();
    if (kind.startsWith("revoke:")) await run(() => api.sync.revokeDevice(kind.slice("revoke:".length)));
    else await run(() => (kind === "reset" ? api.sync.reset() : api.sync.disconnect()));
  }
</script>

{#if browser.isPrivate}
  <Row label={t("syncSection.privateWindow")} hint={t("syncSection.nothingYouDoPrivate")}>
    <Icon name="mask" size={16} />
  </Row>
{:else if !status?.configured}
  <Row
    label={t("syncSection.syncDevices")}
    hint={t("syncSection.bookmarksRecentHistoryOpen")}
  >
    <Icon name="cloud-off" size={18} />
  </Row>
  <Row label={t("syncSection.firstDevice")} hint={t("syncSection.addressSyncServerHttps")} stacked>
    <form class="form" onsubmit={create}>
      <input
        class="field"
        type="url"
        bind:value={serverUrl}
        placeholder="https://sync.exemple.fr"
        aria-label={t("syncSection.syncServerAddress")}
        spellcheck="false"
        autocomplete="off"
        required
      />
      <input
        class="field small"
        type="password"
        bind:value={secret}
        placeholder={t("syncSection.registrationCodeOptional")}
        aria-label={t("syncSection.serverRegistrationCode")}
        autocomplete="off"
      />
      <button class="primary" type="submit" disabled={busy || !serverUrl.trim()}>
        <Icon name="cloud" size={13} /> {t("syncSection.turnSync")}
      </button>
    </form>
  </Row>
  <Row label={t("syncSection.joinExistingAccount")} hint={t("syncSection.pastePairingCodeShown")} stacked>
    <form class="form" onsubmit={pair}>
      <textarea class="field code" bind:value={code} rows="2" placeholder="browser-sync:1:…" aria-label={t("syncSection.pairingCode")} spellcheck="false" required></textarea>
      <button class="primary" type="submit" disabled={busy || !code.trim()}>
        <Icon name="qr" size={13} /> {t("syncSection.pairDevice")}
      </button>
    </form>
  </Row>
{:else}
  <Row label={t("syncSection.status")} hint={statusText}>
    <span class="phase" class:error={status.phase === "error"} class:offline={status.phase === "offline"} data-phase={status.phase}>
      <Icon name={status.phase === "offline" || status.phase === "error" ? "cloud-off" : "cloud"} size={14} />
      {status.phase === "syncing" ? tr("syncSection.progress") : status.phase === "idle" ? t("syncSection.on") : status.phase === "offline" ? "Hors ligne" : tr("syncSection.error")}
    </span>
    <button class="secondary" onclick={() => api.sync.syncNow()} disabled={status.phase === "syncing"}>
      <Icon name="reload" size={13} /> {t("syncSection.syncNow")}
    </button>
  </Row>
  <Row label={t("syncSection.device")} hint={t("syncSection.serverKey", { deviceName: status.deviceName, p: status.serverUrl?.replace(/^https?:\/\//, ""), keyFingerprint: status.keyFingerprint })}>
    <Icon name="laptop" size={16} />
  </Row>
  <Row
    label={t("syncSection.tabsFromMyOther")}
    hint={status.devices.length ? undefined : t("syncSection.noOtherDevicesYet")}
    stacked={status.devices.length > 0}
  >
    {#if status.devices.length}
      <ul class="devices" aria-label={t("syncSection.otherDevices")}>
        {#each status.devices as device (device.id)}
          <li class="device">
            <div class="device-head">
              <Icon name={device.kind === "mobile" ? "smartphone" : "laptop"} size={15} />
              <span class="device-name">{device.name}</span>
              <span class="device-time">{t("syncSection.tabs", { tabsCount: device.tabs.length, p2: ago(device.updatedAt) })}</span>
              <button
                class="danger small"
                class:confirming={confirming === `revoke:${device.id}`}
                disabled={busy}
                onclick={() => confirmed(`revoke:${device.id}`)}
              >
                <Icon name="trash" size={13} />
                {confirming === `revoke:${device.id}` ? t("syncSection.confirmRemove") : t("syncSection.removeDevice")}
              </button>
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
      <p class="note">{t("syncSection.removeDeviceHint")}</p>
    {/if}
  </Row>
  <Row
    label={t("syncSection.addDevice")}
    hint={reveal === "shown"
      ? t("syncSection.phoneSettingsSyncScan")
      : t("syncSection.showsQrCodePairing")}
    stacked={reveal !== "hidden"}
  >
    {#if reveal === "hidden"}
      <button class="secondary" onclick={() => (reveal = "warning")}><Icon name="qr" size={13} /> {t("syncSection.showPairingCode")}</button>
    {:else if reveal === "warning"}
      <div class="warning" role="alert">
        <Icon name="warning" size={16} />
        <p>
          {t("syncSection.codeGives")} <strong>{t("syncSection.fullAccess")}</strong> {t("syncSection.syncedDataBookmarksHistory")}
        </p>
        <div class="buttons">
          <button class="secondary" onclick={hideCode}>{t("syncSection.cancel")}</button>
          <button class="primary" onclick={showCode}>{t("syncSection.showCode")}</button>
        </div>
      </div>
    {:else if pairingCode}
      <div class="pairing">
        <QrCode value={pairingCode} size={196} label={t("syncSection.pairingQrCode")} />
        <div class="pairing-side">
          <textarea class="field code" readonly rows="4" aria-label={t("syncSection.pairingCode")} value={pairingCode}></textarea>
          <div class="buttons">
            <button class="secondary" onclick={copyCode}><Icon name={copied ? "check" : "duplicate"} size={13} /> {copied ? t("syncSection.copied") : t("syncSection.copyCode")}</button>
            <button class="secondary" onclick={hideCode}>{t("syncSection.hide")}</button>
          </div>
        </div>
      </div>
    {/if}
  </Row>
  <Row
    label={t("syncSection.notesHighlights")}
    anchor="annotations"
    keywords={t("syncSection.annotationsNotesHighlight")}
    hint={t("syncSection.optionalAlsoSyncsHighlighted")}
  >
    <Toggle
      label={t("syncSection.syncNotesHighlights")}
      checked={settings.current.annotations.sync}
      onchange={(sync) => settings.update({ annotations: { sync } })}
    />
  </Row>
  <Row
    label={t("syncSection.passwords")}
    anchor="passwords"
    keywords={t("syncSection.passwordsCredentialsKeychain")}
    hint={t("syncSection.optionalOffDefaultPasswords")}
  >
    <Toggle label={t("syncSection.syncPasswords")} checked={settings.current.passwords.sync} onchange={(sync) => settings.update({ passwords: { sync } })} />
  </Row>
  <Row
    label={t("syncSection.webPanels")}
    anchor="panels"
    keywords={t("syncSection.panelsWhatsappSpotify")}
    hint={t("syncSection.optionalFindsSameSidebar")}
  >
    <Toggle label={t("syncSection.syncWebPanels")} checked={settings.current.panels.sync} onchange={(sync) => settings.update({ panels: { sync } })} />
  </Row>
  <Row label={t("syncSection.disconnectDevice")} hint={t("syncSection.stopsSyncHereRemoves")}>
    <button class="danger" class:confirming={confirming === "disconnect"} disabled={busy} onclick={() => confirmed("disconnect")}>
      <Icon name="unlink" size={13} />
      {confirming === "disconnect" ? tr("syncSection.confirm") : t("syncSection.disconnect")}
    </button>
  </Row>
  <Row
    label={t("syncSection.resetSync")}
    hint={t("syncSection.erasesAllDataServer")}
  >
    <button class="danger" class:confirming={confirming === "reset"} disabled={busy} onclick={() => confirmed("reset")}>
      <Icon name="key" size={13} />
      {confirming === "reset" ? t("syncSection.confirmReset") : t("syncSection.reset")}
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
  .danger.small {
    height: 26px;
    padding: 0 8px;
    font-size: 11.5px;
  }
  .note {
    margin: 8px 0 0;
    color: var(--text-muted);
    font-size: 11.5px;
    line-height: 1.45;
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
