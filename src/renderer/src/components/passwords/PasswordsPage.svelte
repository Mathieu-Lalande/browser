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

  const shown = $derived(searchPasswords(entries, query));
  const dateFormat = new Intl.DateTimeFormat(intlLocale(), { dateStyle: "medium" });

  async function refresh(): Promise<void> {
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

    {#if entries.length}
      <SearchField bind:value={query} label={t("passwordsPage.searchPasswords")} placeholder={t("passwordsPage.searchSiteUsername")} />
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
                <span class="site">{originLabel(entry.origin)}</span>
                <span class="user">{entry.username || tr("passwordsPage.noUsername")}</span>
                <span class="secret" class:mono={entry.id in revealed} data-testid="password-value">{revealed[entry.id] ?? "••••••••••"}</span>
                <span class="detail">
                  {t("passwordsPage.modifiedOn", { date: dateFormat.format(entry.updatedAt) })}{entry.lastUsedAt ? t("passwordsPage.usedOn", { date: dateFormat.format(entry.lastUsedAt) }) : ""}
                </span>
              </span>
              <span class="actions">
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
    gap: 8px;
    margin: 0;
    padding: 8px 10px 8px 12px;
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
  .site {
    font-weight: 600;
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
    padding: 0 10px;
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
    gap: 8px;
  }

  .edit-actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }
</style>
