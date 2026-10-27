<script lang="ts">
  import { PERMISSION_LABELS, cookieCount, type SiteInfo, type SitePermission } from "@shared/site-info";
  import type { Bounds, TabId } from "@shared/types";
  import { api, browser } from "../lib/browser.svelte";
  import Icon from "../components/Icon.svelte";
  import ConfirmButton from "../components/settings/ConfirmButton.svelte";
  import Toggle from "../components/settings/Toggle.svelte";

  /**
   * Site info popover (ADR-021), hanging below the address bar's lock: connection and certificate,
   * cookies and site data, permissions, shields and zoom of the tab's site. Main reads everything
   * from the tab (its URL and session): this page only names the tab.
   */
  let { anchor, tabId, onClose }: { anchor?: Bounds; tabId: TabId; onClose: (restoreFocus: boolean) => void } = $props();

  const WIDTH = 340;
  const MARGIN = 8;

  let panel = $state<HTMLElement>();
  let innerWidth = $state(window.innerWidth);
  let innerHeight = $state(window.innerHeight);
  let info = $state<SiteInfo | null>(null);
  let loaded = $state(false);
  let cleared = $state(false);
  let copied = $state(false);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;

  /** Shields and zoom follow the live tab state (the page reloads, the zoom changes…). */
  const tab = $derived(browser.state.tabs.find((item) => item.id === tabId));
  const secure = $derived(info?.connection === "https");

  const position = $derived.by(() => {
    const box = anchor ?? { x: MARGIN, y: MARGIN, width: 0, height: 0 };
    const top = Math.max(MARGIN, box.y + box.height + 6);
    const left = Math.max(MARGIN, Math.min(box.x - 6, innerWidth - WIDTH - MARGIN));
    return { left, top, maxHeight: Math.max(200, innerHeight - top - MARGIN) };
  });

  const refresh = () =>
    api.siteInfo.get(tabId).then(
      (next) => ((info = next), (loaded = true)),
      () => (loaded = true),
    );

  $effect(() => {
    void refresh();
  });
  $effect(() => panel?.focus());

  const dateFormat = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" });
  const date = (ms: number) => dateFormat.format(new Date(ms));

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose(true);
    }
  }

  async function clearData(): Promise<void> {
    const next = await api.siteInfo.clearData(tabId).catch(() => null);
    if (next) info = next;
    cleared = true;
  }

  async function resetPermission(permission: SitePermission): Promise<void> {
    const next = await api.siteInfo.resetPermission(tabId, permission.origin, permission.kind).catch(() => null);
    if (next) info = next;
  }

  async function allowThirdParty(allow: boolean): Promise<void> {
    const next = await api.siteInfo.allowThirdPartyCookies(tabId, allow).catch(() => null);
    if (next) info = next;
  }

  function copyLink(): void {
    api.commands.run("copy-url");
    copied = true;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copied = false), 1600);
  }
</script>

<!-- On the window: a button that just went away (confirmed action) leaves the focus on the page body. -->
<svelte:window bind:innerWidth bind:innerHeight onkeydown={onKeydown} />

<div
  bind:this={panel}
  class="panel"
  role="dialog"
  aria-label="Infos sur le site"
  tabindex="-1"
  style:left="{position.left}px"
  style:top="{position.top}px"
  style:max-height="{position.maxHeight}px"
  style:width="{WIDTH}px"
>
  {#if info}
    <header>
      <span class="badge" class:warn={!secure}><Icon name={secure ? "lock" : "warning"} size={16} /></span>
      <div class="heading">
        <h2>{info.host}</h2>
        <p class:warn-text={!secure}>{secure ? "Connexion sécurisée" : "Connexion non sécurisée"}</p>
      </div>
      <button class="copy" class:done={copied} onclick={copyLink} aria-label={copied ? "Lien copié" : "Copier le lien"} title={copied ? "Lien copié" : "Copier le lien"}>
        {#key copied}<span class="glyph"><Icon name={copied ? "check" : "link"} size={14} /></span>{/key}
        <span>{copied ? "Lien copié" : "Copier le lien"}</span>
      </button>
    </header>

    <div class="body">
      <section aria-label="Connexion">
        {#if secure}
          <p class="note">Les informations échangées avec ce site (mots de passe, cartes bancaires) sont chiffrées.</p>
          {#if info.certificate}
            <details class="certificate">
              <summary><Icon name="certificate" size={12} /> Certificat</summary>
              <dl>
                <dt>Délivré à</dt>
                <dd>{info.certificate.subject}</dd>
                <dt>Délivré par</dt>
                <dd>{info.certificate.issuer}</dd>
                <dt>Validité</dt>
                <dd>du {date(info.certificate.validFrom)} au {date(info.certificate.validTo)}</dd>
                <dt>Empreinte</dt>
                <dd class="mono">{info.certificate.fingerprint}</dd>
              </dl>
            </details>
          {:else}
            <p class="hint">Détails du certificat indisponibles pour cette connexion (établie avant leur enregistrement).</p>
          {/if}
        {:else}
          <p class="note warn-text">
            Ne saisissez pas d'informations sensibles sur ce site : elles pourraient être lues ou modifiées par d'autres.
          </p>
        {/if}
      </section>

      <section aria-labelledby="site-cookies">
        <div class="line">
          <Icon name="cookie" size={14} />
          <span class="label" id="site-cookies">Cookies et données du site</span>
          <span class="value" data-testid="cookie-count">{cookieCount(info.cookies)}</span>
        </div>
        <div class="actions">
          {#if cleared}<span class="done-note"><Icon name="check" size={12} /> Données effacées</span>{/if}
          <ConfirmButton variant="outlined" question="Effacer et recharger ?" confirmLabel="Effacer" onconfirm={clearData}>
            <Icon name="trash" size={12} /> Effacer les cookies et données du site
          </ConfirmButton>
        </div>
        {#if info.thirdPartyCookies.blocking}
          <div class="line">
            <span class="label">Autoriser les cookies tiers sur ce site</span>
            {#if info.isPrivate}
              <span class="value">{info.thirdPartyCookies.allowedHere ? "Autorisés" : "Bloqués"}</span>
            {:else}
              <Toggle label="Autoriser les cookies tiers sur ce site" checked={info.thirdPartyCookies.allowedHere} onchange={allowThirdParty} />
            {/if}
          </div>
        {/if}
      </section>

      <section aria-labelledby="site-permissions">
        <div class="line"><Icon name="key" size={14} /><span class="label" id="site-permissions">Autorisations</span></div>
        {#if info.permissions.length}
          <ul class="permissions">
            {#each info.permissions as permission (`${permission.origin} ${permission.kind}`)}
              <li>
                <span class="text">
                  <span>{PERMISSION_LABELS[permission.kind]}</span>
                  <span class="hint">
                    {permission.decision === "allow" ? "Autorisé" : "Bloqué"}{permission.remembered ? "" : " jusqu'à la fermeture"}{permission.origin !== info.origin ? ` · ${permission.origin}` : ""}
                  </span>
                </span>
                <button class="reset" onclick={() => resetPermission(permission)} aria-label="Réinitialiser : {PERMISSION_LABELS[permission.kind]}" title="Le site demandera de nouveau">
                  <Icon name="reset" size={12} /> Réinitialiser
                </button>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="hint">Aucune autorisation accordée ni refusée à ce site.</p>
        {/if}
      </section>

      {#if tab}
        <section aria-labelledby="site-shields">
          <div class="line">
            <Icon name={tab.shieldsEnabled ? "shield" : "shield-off"} size={14} />
            <span class="label" id="site-shields">Protections</span>
            <span class="value">{tab.shieldsEnabled ? `${tab.blockedCount} bloqué${tab.blockedCount > 1 ? "s" : ""}` : "Désactivées"}</span>
            <Toggle label="Protections sur ce site" checked={tab.shieldsEnabled} onchange={() => api.tabs.toggleShields(tabId)} />
          </div>
        </section>

        <section aria-labelledby="site-zoom">
          <div class="line">
            <Icon name="zoom-in" size={14} />
            <span class="label" id="site-zoom">Zoom</span>
            <span class="value">{tab.zoom}&#8239;%</span>
            <button class="reset" disabled={tab.zoom === info.defaultZoom} onclick={() => api.commands.run("zoom-reset")}>
              <Icon name="reset" size={12} /> {info.defaultZoom}&#8239;%
            </button>
          </div>
        </section>
      {/if}

      {#if info.isPrivate}
        <p class="hint private"><Icon name="mask" size={12} /> Fenêtre privée : ces réglages ne valent que pour elle, rien n'est enregistré.</p>
      {/if}
    </div>
  {:else if loaded}
    <p class="empty">Aucune information pour cette page.</p>
  {/if}
</div>

<style>
  .panel {
    position: fixed;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-radius: calc(var(--radius) + 4px);
    background: var(--bg-elevated);
    box-shadow:
      0 0 0 1px var(--border),
      0 18px 50px -12px rgb(0 0 0 / 0.55),
      0 4px 14px -6px rgb(0 0 0 / 0.35);
    outline: none;
    animation: pop 0.16s var(--ease);
    transform-origin: top left;
  }
  header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 10px 10px 14px;
    border-bottom: 1px solid var(--border);
  }
  .badge {
    display: grid;
    flex: none;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 10px;
    background: color-mix(in oklab, var(--accent) 14%, transparent);
    color: var(--accent-text);
  }
  .badge.warn {
    background: var(--surface-active);
    color: var(--text);
  }
  .heading {
    flex: 1;
    min-width: 0;
  }
  h2 {
    margin: 0;
    overflow: hidden;
    font-size: 13.5px;
    font-weight: 600;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  p {
    margin: 0;
  }
  .heading p {
    color: var(--text-muted);
    font-size: 12px;
  }
  .copy {
    display: flex;
    flex: none;
    align-items: center;
    gap: 5px;
    height: 26px;
    padding: 0 8px;
    border-radius: 7px;
    color: var(--accent-text);
    font-size: 12px;
    font-weight: 500;
  }
  .copy:hover {
    background: var(--surface-hover);
  }
  .glyph {
    display: grid;
  }
  .copy.done .glyph {
    animation: check-pop 0.32s var(--ease);
  }
  .body {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow-y: auto;
  }
  section {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 14px;
  }
  section + section {
    border-top: 1px solid var(--border);
  }
  .line {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 26px;
    color: var(--text-muted);
  }
  .label {
    flex: 1;
    color: var(--text);
  }
  .value {
    color: var(--text-muted);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .note {
    color: var(--text-muted);
    font-size: 12px;
    line-height: 1.45;
  }
  .hint {
    color: var(--text-muted);
    font-size: 11.5px;
  }
  .warn-text {
    color: var(--text);
  }
  .certificate summary {
    display: flex;
    align-items: center;
    gap: 6px;
    width: fit-content;
    padding: 3px 6px;
    margin-left: -6px;
    border-radius: 6px;
    color: var(--accent-text);
    font-size: 12px;
    cursor: pointer;
    list-style: none;
  }
  .certificate summary:hover {
    background: var(--surface-hover);
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 10px;
    margin: 6px 0 0;
    font-size: 12px;
  }
  dt {
    color: var(--text-muted);
  }
  dd {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .mono {
    font-family: ui-monospace, monospace;
    font-size: 11px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
  }
  .done-note {
    display: flex;
    align-items: center;
    gap: 5px;
    color: var(--text-muted);
    font-size: 12px;
  }
  .permissions {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .permissions li {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .text {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }
  .reset {
    display: flex;
    flex: none;
    align-items: center;
    gap: 5px;
    height: 26px;
    padding: 0 8px;
    border-radius: 7px;
    color: var(--text-muted);
    font-size: 12px;
  }
  .reset:hover:not(:disabled) {
    background: var(--surface-hover);
    color: var(--text);
  }
  .reset:disabled {
    opacity: 0.45;
  }
  .private {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 14px 12px;
  }
  .empty {
    padding: 18px;
    color: var(--text-muted);
    text-align: center;
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: translateY(-6px) scale(0.98);
    }
  }
  @keyframes check-pop {
    from {
      opacity: 0;
      transform: scale(0.4) rotate(-20deg);
    }
    60% {
      transform: scale(1.2);
    }
  }
</style>
