<script lang="ts">
  import { t } from "@shared/i18n";
  import type { PermissionKind, PermissionPrompt, TabId } from "@shared/types";
  import { api, browser } from "../lib/browser.svelte";
  import Checkbox from "./ui/Checkbox.svelte";
  import Icon from "./Icon.svelte";

  let { tabId, prompt }: { tabId: TabId; prompt: PermissionPrompt } = $props();

  const LABELS: Record<PermissionKind, string> = {
    camera: t("permissionBar.useCamera"),
    microphone: t("permissionBar.useMicrophone"),
    geolocation: t("permissionBar.knowLocation"),
    notifications: t("permissionBar.sendYouNotifications"),
    midi: t("permissionBar.accessMidiDevices"),
    "midi-sysex": t("permissionBar.fullyControlMidiDevices"),
    "clipboard-read": t("permissionBar.readClipboard"),
    "display-capture": t("permissionBar.captureScreen"),
    "idle-detection": t("permissionBar.knowWhenYoureIdle"),
    "window-management": t("permissionBar.manageWindowsScreens"),
    "storage-access": t("permissionBar.useCookiesOtherSites"),
    "local-fonts": t("permissionBar.listInstalledFonts"),
  };

  let remember = $state(false);
  // A new prompt starts with "remember" unchecked.
  $effect.pre(() => {
    void prompt.id;
    remember = false;
  });

  const hostOf = (origin: string) => {
    try {
      return new URL(origin).host;
    } catch {
      return origin;
    }
  };
  const host = $derived(hostOf(prompt.origin));
  /** The site embedding the asking frame, when it is another one: the decision only holds there. */
  const embedder = $derived(prompt.topOrigin ? hostOf(prompt.topOrigin) : null);
  const request = $derived(new Intl.ListFormat("fr", { type: "conjunction" }).format(prompt.kinds.map((kind) => LABELS[kind])));

  function answer(allow: boolean): void {
    api.permissions.respond(tabId, prompt.id, allow, remember);
  }
</script>

<div class="permission-bar" role="alertdialog" aria-label={t("permissionBar.permissionRequest")}>
  <Icon name="shield" size={16} />
  <p><strong>{host}</strong>{#if embedder}&nbsp;<span class="embedder">{t("permissionBar.embedded", { embedder })}</span>{/if} {t("permissionBar.wants", { request })}</p>
  <!-- Private window: decisions last as long as the window, nothing is remembered (ADR-014). -->
  {#if !browser.isPrivate}
    <span class="remember"><Checkbox checked={remember} onchange={(value) => (remember = value)}>{t("permissionBar.rememberSite")}</Checkbox></span>
  {/if}
  <button class="secondary" onclick={() => answer(false)}>{t("permissionBar.block")}</button>
  <button class="primary" onclick={() => answer(true)}>{t("permissionBar.allow")}</button>
</div>

<style>
  .permission-bar {
    display: flex;
    flex: none;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    padding: 6px 8px 6px 14px;
    border-radius: var(--radius);
    background: var(--bg-elevated);
    box-shadow: 0 0 0 1px color-mix(in oklab, var(--accent) 35%, transparent);
    color: var(--accent-text);
    animation: drop 0.18s var(--ease);
  }
  p {
    flex: 1;
    min-width: 200px;
    margin: 0;
    color: var(--text);
  }
  .embedder {
    color: var(--text-muted);
  }
  .remember {
    color: var(--text-muted);
    font-size: 12px;
  }
  button {
    height: 30px;
    padding: 0 14px;
    border-radius: 8px;
    font-weight: 500;
  }
  .secondary {
    background: var(--surface);
  }
  .secondary:hover {
    background: var(--surface-hover);
  }
  .primary {
    background: var(--accent);
    color: var(--on-accent);
  }
  .primary:hover {
    background: color-mix(in oklab, var(--accent) 85%, #fff);
  }
  @keyframes drop {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
  }
</style>
