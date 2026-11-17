<script lang="ts">
  import { t as tr, t, intlLocale } from "@shared/i18n";
  import ListRow from "../ui/ListRow.svelte";
  import Card from "../ui/Card.svelte";
  import { originLabel, searchPasswords, type PasswordSummary, type PasswordsStatus } from "@shared/passwords";
  import { api } from "../../lib/browser.svelte";
  import Icon from "../Icon.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import ConfirmButton from "../ui/ConfirmButton.svelte";
  import Button from "../ui/Button.svelte";
  import EmptyState from "../ui/EmptyState.svelte";
  import Page from "../ui/Page.svelte";
  import SearchField from "../ui/SearchField.svelte";
  import Segmented from "../ui/Segmented.svelte";
  import PasswordCheckup from "./PasswordCheckup.svelte";
  import type { CheckupReport, PasswordIssue } from "@shared/password-checkup";
  import { VAULT_LOCK_MINUTES, type VaultLockState } from "@shared/vault-lock";
  import { settings } from "../../lib/settings.svelte";

  /**
   * `browser://passwords` (ADR-025): saved passwords, searched by site or username. The list has
   * no password: "Afficher" asks for a confirmation, then main sends that one password; copying
   * and exporting happen in main (clipboard, save dialog).
   */

  let entries = $state<PasswordSummary[]>([]);
  let never = $state<string[]>([]);
  let status = $state<PasswordsStatus | null>(null);
  let loaded = $state(false);
  let query = $state("");
  /** Passwords shown after confirmation, by entry id (forgotten on the next refresh). */
  let revealed = $state<Record<string, string>>({});
  let editing = $state<{ id: string; username: string; password: string } | null>(null);
  let notice = $state<{ kind: "error" | "success"; text: string } | null>(null);
  let copiedId = $state<string | null>(null);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  let request = 0;

  let report = $state<CheckupReport | null>(null);
  let filter = $state<"all" | "issues">("all");
  const issues = $derived(new Map<string, PasswordIssue>((report?.issues ?? []).map((issue) => [issue.id, issue])));
  const shown = $derived(searchPasswords(entries, query).filter((entry) => filter === "all" || issues.has(entry.id)));
  const dateFormat = new Intl.DateTimeFormat(intlLocale(), { dateStyle: "medium" });

  let lock = $state<VaultLockState | null>(null);
  const refreshLock = () => void api.passwords.lockState().then((next) => (lock = next), () => null);
  const lockOptions = VAULT_LOCK_MINUTES.map((minutes) => ({ value: String(minutes), label: minutes ? t("vaultLock.minutes", { minutes }) : t("vaultLock.never") }));

  async function refresh(): Promise<void> {
    refreshLock();
    const id = ++request;
    const [list, neverList, current] = await Promise.all([
      api.passwords.list().catch(() => []),
      api.passwords.neverList().catch(() => []),
      api.passwords.status().catch(() => null),
    ]);
    if (id !== request) return;
    entries = list;
    never = neverList;
    status = current;
    revealed = {};
    loaded = true;
  }

  $effect(() => {
    void refresh();
    return api.passwords.onChanged(() => void refresh());
  });

  async function reveal(id: string): Promise<void> {
    const result = await api.passwords.reveal(id).catch(() => ({ ok: false as const, message: t("passwordsPage.passwordCouldntShown") }));
    if (result.ok) revealed = { ...revealed, [id]: result.password };
    else notice = { kind: "error", text: result.message };
    refreshLock();
  }

  function hide(id: string): void {
    const { [id]: _hidden, ...rest } = revealed;
    revealed = rest;
  }

  async function copy(id: string): Promise<void> {
    const result = await api.passwords.copy(id).catch(() => ({ ok: false as const, message: t("passwordsPage.passwordCouldntCopied") }));
    if (!result.ok) {
      notice = { kind: "error", text: result.message };
      return;
    }
    refreshLock();
    copiedId = id;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copiedId = null), 1600);
  }

  async function saveEdit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!editing) return;
    const { id, username, password } = editing;
    const result = await api.passwords.update(id, password ? { username, password } : { username }).catch(() => ({ ok: false as const, message: t("passwordsPage.changeFailed") }));
    if (result.ok) {
      editing = null;
      notice = null;
    } else notice = { kind: "error", text: result.message };
  }

  async function exportCsv(): Promise<void> {
    const result = await api.passwords.exportCsv().catch(() => ({ ok: false as const, message: t("passwordsPage.exportFailed") }));
    if (!result) return;
    notice = result.ok ? { kind: "success", text: t("passwordsPage.passwordsExported") } : { kind: "error", text: result.message };
  }
</script>

<Page
  icon="key"
  title={t("passwordsPage.passwords")}
  subtitle={t("passwordsPage.offeredAfterSignEncrypted")}
  testid="passwords-page"
>
  {#snippet actions()}
    {#if entries.length}
      <ConfirmButton
        variant="outlined"
        question={t("passwordsPage.exportPlainTextCsv")}
        confirmLabel={t("passwordsPage.export")}
        title={t("passwordsPage.exportPasswordsUnencryptedCsv")}
        onconfirm={exportCsv}
      >
        <Icon name="file-down" size={14} /> {t("passwordsPage.export")}
      </ConfirmButton>
    {/if}
  {/snippet}

    {#if status && !status.available}
      <p class="notice error" role="alert"><Icon name="warning" size={14} /> <span>{status.message}</span></p>
    {:else if status?.weak}
      <p class="notice"><Icon name="warning" size={14} /> <span>{t("passwordsPage.noSystemKeychainDetected")}</span></p>
    {/if}
    {#if notice}
      <p class="notice {notice.kind}" role={notice.kind === "error" ? "alert" : "status"}>
        <Icon name={notice.kind === "error" ? "warning" : "check"} size={14} />
        <span>{notice.text}</span>
        <IconButton size="row" icon="close" iconSize={12} label={t("passwordsPage.closeMessage")} onclick={() => (notice = null)} />
      </p>
    {/if}

    {#if entries.length && lock}
      <div class="lock" class:locked={lock.locked} data-testid="vault-lock">
        <span class="lock-state"><Icon name={lock.locked ? "lock" : "lock-open"} size={14} /> {lock.locked ? t("vaultLock.locked") : t("vaultLock.open")}</span>
        <span class="lock-delay" title={t("vaultLock.hint")}>
          {t("vaultLock.delayLabel")}
          <Segmented
            value={String(settings.current.passwords.lockMinutes)}
            label={t("vaultLock.delayLabel")}
            options={lockOptions}
            onchange={(value) => (settings.update({ passwords: { lockMinutes: Number(value) } }), setTimeout(refreshLock, 50))}
          />
        </span>
        {#if !lock.locked && lock.lockMinutes}
          <Button size="sm" variant="quiet" icon="lock" onclick={() => (api.passwords.lock(), (revealed = {}), setTimeout(refreshLock, 50))}>{t("vaultLock.lockNow")}</Button>
        {/if}
      </div>
    {/if}
    {#if entries.length}
      <PasswordCheckup bind:report />
      <div class="tools">
        <SearchField bind:value={query} label={t("passwordsPage.searchPasswords")} placeholder={t("passwordsPage.searchSiteUsername")} />
        {#if report?.issues.length}
          <Segmented
            value={filter}
            label={t("passwordCheckup.filterLabel")}
            options={[
              { value: "all", label: t("passwordCheckup.filterAll") },
              { value: "issues", label: `${t("passwordCheckup.filterIssues")} · ${report.issues.length}` },
            ]}
            onchange={(next) => (filter = next)}
          />
        {/if}
      </div>
      <Card as="ul" aria-label={t("passwordsPage.savedPasswords")}>
        {#each shown as entry (entry.id)}
          <ListRow data-password-id={entry.id}>
            {#if editing?.id === entry.id}
              <form class="edit" onsubmit={saveEdit}>
                <span class="site">{originLabel(entry.origin)}</span>
                <input class="ui-field" bind:value={editing.username} aria-label={t("passwordsPage.username")} placeholder={t("passwordsPage.username")} spellcheck="false" />
                <input class="ui-field" bind:value={editing.password} type="password" aria-label={t("passwordsPage.newPassword")} placeholder={t("passwordsPage.newPasswordUnchangedIf")} autocomplete="new-password" />
                <span class="edit-actions">
                  <Button size="sm" variant="ghost" onclick={() => (editing = null)}>{t("passwordsPage.cancel")}</Button>
                  <Button size="sm" variant="primary" type="submit">{t("passwordsPage.save")}</Button>
                </span>
              </form>
            {:else}
              <span class="text">
                <span class="site">
                  {originLabel(entry.origin)}
                  {#if issues.get(entry.id)}
                    {@const issue = issues.get(entry.id)!}
                    {#if (issue.breached ?? 0) > 0}<span class="badge breached" data-testid="badge-breached">{t("passwordCheckup.badgeBreached")}</span>{/if}
                    {#if issue.reused}<span class="badge reused">{t("passwordCheckup.badgeReused", { count: issue.reused })}</span>{/if}
                    {#if issue.weak}<span class="badge weak">{t("passwordCheckup.badgeWeak")}</span>{/if}
                  {/if}
                </span>
                <span class="user">{entry.username || tr("passwordsPage.noUsername")}</span>
                <span class="secret" class:mono={entry.id in revealed} data-testid="password-value">{revealed[entry.id] ?? "••••••••••"}</span>
                <span class="detail">
                  {t("passwordsPage.modifiedOn", { date: dateFormat.format(entry.updatedAt) })}{entry.lastUsedAt ? t("passwordsPage.usedOn", { date: dateFormat.format(entry.lastUsedAt) }) : ""}
                </span>
              </span>
              <span class="actions">
                {#if issues.has(entry.id)}
                  <IconButton size="row" icon="open" iconSize={14} title={t("passwordCheckup.change")} label={`${t("passwordCheckup.change")} : ${originLabel(entry.origin)}`} onclick={() => api.tabs.create(entry.origin)} />
                {/if}
                {#if entry.id in revealed}
                  <IconButton size="row" icon="eye-off" iconSize={14} title={t("passwordsPage.hide")} label={t("passwordsPage.hidePassword", { p: originLabel(entry.origin) })} onclick={() => hide(entry.id)} />
                {:else}
                  <ConfirmButton question={t("passwordsPage.showPassword")} confirmLabel={t("passwordsPage.show")} title={t("passwordsPage.showPassword2", { p: originLabel(entry.origin) })} onconfirm={() => reveal(entry.id)}>
                    <Icon name="eye" size={14} />
                  </ConfirmButton>
                {/if}
                <IconButton
                  size="row"
                  icon={copiedId === entry.id ? "check" : "copy-text"}
                  iconSize={14}
                  title={copiedId === entry.id ? t("passwordsPage.copied") : t("passwordsPage.copyPassword")}
                  label={t("passwordsPage.copyPassword2", { p: originLabel(entry.origin) })}
                  onclick={() => copy(entry.id)}
                />
                <IconButton
                  size="row"
                  icon="pencil"
                  iconSize={14}
                  title={t("passwordsPage.edit")}
                  label={t("passwordsPage.editPassword", { p: originLabel(entry.origin) })}
                  onclick={() => (editing = { id: entry.id, username: entry.username, password: "" })}
                />
                <ConfirmButton question={t("passwordsPage.deletePassword")} confirmLabel={t("passwordsPage.delete")} title={t("passwordsPage.deletePassword2", { p: originLabel(entry.origin) })} onconfirm={() => api.passwords.remove(entry.id)}>
                  <Icon name="trash" size={14} />
                </ConfirmButton>
              </span>
            {/if}
          </ListRow>
        {:else}
          <ListRow class="empty-row">{t("passwordsPage.noResults", { query })}</ListRow>
        {/each}
      </Card>
    {:else if loaded}
      <EmptyState icon="key" title={t("passwordsPage.noSavedPasswords")} hint={t("passwordsPage.signSiteBrowserWill")} />
    {/if}

    {#if never.length}
      <section class="ui-section">
        <h2 class="ui-section-title"><Icon name="ban" size={14} /> {t("passwordsPage.neverSaved")}</h2>
        <Card as="ul" aria-label={t("passwordsPage.sitesNeverSaved")}>
          {#each never as origin (origin)}
            <ListRow>
              <span class="text"><span class="site">{originLabel(origin)}</span></span>
              <button class="text-button" aria-label={t("passwordsPage.removeFromList", { p: originLabel(origin) })} onclick={() => api.passwords.removeNever(origin)}>{t("passwordsPage.remove")}</button>
            </ListRow>
          {/each}
        </Card>
      </section>
    {/if}
</Page>

<style>
  .notice {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    padding: var(--space-2) var(--space-2) var(--space-2) var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    line-height: 1.4;
  }
  .notice span {
    flex: 1;
  }
  .notice.error {
    border-color: color-mix(in oklab, var(--danger) 45%, transparent);
    color: var(--danger-text);
  }
  :global(.row.empty-row) {
    color: var(--text-muted);
  }
  .text {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .lock {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-4);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    font-size: var(--text-sm);
  }
  .lock-state {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--success);
    font-weight: 600;
  }
  .lock.locked .lock-state {
    color: var(--accent-text);
  }
  .lock-delay {
    display: inline-flex;
    flex: 1;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    color: var(--text-muted);
  }
  .tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
  }
  .tools > :global(:first-child) {
    flex: 1 1 240px;
  }
  .site {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-2);
    font-weight: 600;
  }
  .badge {
    --c: var(--danger);
    padding: 0 var(--space-2);
    border-radius: var(--radius-pill);
    background: color-mix(in oklab, var(--c) 14%, transparent);
    color: color-mix(in oklab, var(--c) 75%, var(--text));
    font-size: var(--text-xs);
    font-weight: 500;
    line-height: 1.6;
  }
  .badge.reused {
    --c: color-mix(in oklab, var(--danger) 45%, var(--accent-2));
  }
  .badge.weak {
    --c: var(--accent);
  }
  .secret {
    color: var(--text-muted);
    letter-spacing: 0.08em;
  }
  .secret.mono {
    color: var(--text);
    font-family: var(--font-mono, monospace);
    letter-spacing: 0;
  }
  .detail {
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
  .actions {
    display: flex;
    flex: none;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 2px;
  }
  .text-button {
    height: 28px;
    padding: 0 var(--space-2);
    border-radius: 7px;
    color: var(--text-muted);
  }
  .text-button:hover {
    background: var(--surface-hover);
    color: var(--text);
  }
  .text-button.strong {
    color: var(--accent-text);
    font-weight: 600;
  }
  .edit {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--space-2);
  }

  .edit-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-1);
  }
</style>
