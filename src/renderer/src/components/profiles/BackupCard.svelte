<script lang="ts">
  import { t as tr, t, intlLocale } from "@shared/i18n";
  import { MIN_PASSPHRASE, type BackupMode, type BackupSection, type BackupSummary } from "@shared/backup";
  import { api } from "../../lib/browser.svelte";
  import Button from "../ui/Button.svelte";
  import Card from "../ui/Card.svelte";
  import Checkbox from "../ui/Checkbox.svelte";
  import Segmented from "../ui/Segmented.svelte";

  /**
   * Backup of the open profile (ADR-042): export to a `.browserbackup` file (passwords only when
   * asked for, sealed with a passphrase), import with a summary first, then merge or replace.
   * Cookies and site data are never part of a backup.
   */

  const LABELS: Record<BackupSection | "passwords", string> = {
    settings: t("backupCard.settings"),
    bookmarks: t("backupCard.bookmarks"),
    favorites: t("backupCard.favoritesGrid"),
    history: t("backupCard.historyPages"),
    session: t("backupCard.sessionWindows"),
    boosts: "Boosts",
    annotations: t("backupCard.notesHighlights"),
    archive: t("backupCard.archivedTabs"),
    passwords: t("backupCard.passwords"),
  };

  let withPasswords = $state(false);
  let exportSecret = $state("");
  /** One status line for the last export or import (a single live region). */
  let message = $state("");
  let summary = $state<BackupSummary | null>(null);
  let mode = $state<BackupMode>("merge");
  let importSecret = $state("");
  let busy = $state(false);

  const exportReady = $derived(!withPasswords || exportSecret.length >= MIN_PASSPHRASE);

  async function doExport(): Promise<void> {
    busy = true;
    const result = await api.backup.export(withPasswords ? exportSecret : null).catch(() => ({ ok: false as const, message: t("backupCard.exportFailed") }));
    busy = false;
    message = result.ok ? t("backupCard.backupSaved") : result.message;
    if (result.ok) exportSecret = "";
  }

  async function pick(): Promise<void> {
    message = "";
    const result = await api.backup.inspect().catch(() => ({ ok: false as const, message: t("backupCard.fileCouldntRead") }));
    if (result.ok) summary = result.summary;
    else message = result.message;
  }

  async function apply(): Promise<void> {
    busy = true;
    const secret = summary?.hasPasswords && importSecret ? importSecret : null;
    const result = await api.backup.apply(mode, secret).catch(() => ({ ok: false as const, message: t("backupCard.importFailed") }));
    busy = false;
    if (result.ok) {
      summary = null;
      importSecret = "";
      message = t("backupCard.backupImported");
    } else message = result.message;
  }

  const dateFormat = new Intl.DateTimeFormat(intlLocale(), { dateStyle: "long", timeStyle: "short" });
</script>

<section class="ui-section" aria-labelledby="backup-title">
  <h2 class="ui-section-title" id="backup-title">{t("backupCard.profileBackup")}</h2>
  <Card as="div" variant="section" data-testid="backup">
    <div class="body">
      <p class="ui-section-hint">
        {t("backupCard.exportsSettingsBookmarksHistory")}
      </p>
      <Checkbox checked={withPasswords} onchange={(checked) => (withPasswords = checked)}>{t("backupCard.includePasswordsEncryptedPassphrase")}</Checkbox>
      {#if withPasswords}
        <input
          class="ui-field"
          type="password"
          autocomplete="new-password"
          aria-label={t("backupCard.backupPassphrase")}
          placeholder={t("backupCard.passphraseLeastCharacters", { MIN_PASSPHRASE })}
          bind:value={exportSecret}
        />
      {/if}
      <div class="buttons">
        <Button variant="primary" icon="file-down" disabled={busy || !exportReady} onclick={doExport}>{t("backupCard.exportProfile")}</Button>
        <Button icon="file-up" disabled={busy} onclick={pick}>{t("backupCard.importBackup")}</Button>
        {#if message}<span class="message" role="status">{message}</span>{/if}
      </div>
    </div>

    {#if summary}
      <div class="body summary" aria-label={t("backupCard.backupContent")}>
        <p>
          {summary.profileName ? t("backupCard.backupOfProfile", { name: summary.profileName }) : t("backupCard.backup")}{summary.createdAt ? `, ${dateFormat.format(summary.createdAt)}` : ""}{t("backupCard.colon")}
        </p>
        <ul>
          {#each Object.entries(summary.counts) as [section, count] (section)}
            <li>{LABELS[section as BackupSection]} : {count}</li>
          {/each}
          {#if summary.hasPasswords}<li>{t("backupCard.encrypted", { passwords: LABELS.passwords })}</li>{/if}
        </ul>
        <Segmented
          label={t("backupCard.import")}
          value={mode}
          options={[
            { value: "merge" as BackupMode, label: t("backupCard.merge") },
            { value: "replace" as BackupMode, label: t("backupCard.replace") },
          ]}
          onchange={(value) => (mode = value)}
        />
        <p class="ui-section-hint">
          {mode === "merge" ? t("backupCard.addsWhatsMissingKeeps") : t("backupCard.replacesProfilesSettingsData")}
        </p>
        {#if summary.hasPasswords}
          <input
            class="ui-field"
            type="password"
            autocomplete="off"
            aria-label={t("backupCard.passphrasePasswords")}
            placeholder={t("backupCard.passphraseLeaveEmptySkip")}
            bind:value={importSecret}
          />
        {/if}
        <div class="buttons end">
          <Button variant="quiet" onclick={() => (summary = null)}>{t("backupCard.cancel")}</Button>
          <Button variant={mode === "replace" ? "danger" : "primary"} disabled={busy} onclick={apply}>{mode === "merge" ? tr("backupCard.merge2") : "Remplacer"}</Button>
        </div>
      </div>
    {/if}
  </Card>
</section>

<style>
  /* The card's content keeps the same inner margin as a settings row (`Row`). */
  .body {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-4);
  }
  .body + .body {
    border-top: 1px solid var(--border);
  }
  .body > :global(.ui-field) {
    align-self: stretch;
  }
  .buttons {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    align-self: stretch;
    gap: var(--space-2);
  }
  .buttons.end {
    justify-content: flex-end;
  }
  .message {
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
  .summary p {
    margin: 0;
  }
  .summary ul {
    margin: 0;
    padding-left: var(--space-4);
    color: var(--text-muted);
  }
</style>
