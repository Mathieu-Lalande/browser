<script lang="ts">
  import { t } from "@shared/i18n";
  import { acceleratorFromKeyPress, acceleratorKeys, type KeyPress } from "@shared/accelerators";
  import type { ExtensionCommandRow } from "@shared/extensions";
  import type { ShortcutIssue } from "@shared/extension-commands";
  import { api, browser } from "../../lib/browser.svelte";
  import { shortcutIssueText } from "../../lib/extension-shortcuts";
  import { platform } from "../../lib/platform.svelte";
  import Card from "../ui/Card.svelte";
  import EmptyState from "../ui/EmptyState.svelte";
  import Icon from "../Icon.svelte";
  import IconButton from "../ui/IconButton.svelte";

  /**
   * The extensions' shortcut editor (ADR-057, like `chrome://extensions/shortcuts`): every command
   * of the enabled extensions with its key. Clicking a key captures the next combination (main
   * swallows it, as in the settings' shortcuts, ADR-028); main checks it against the browser's
   * shortcuts and the other extensions' and refuses a key already taken. Backspace clears it,
   * "Rétablir" brings back the manifest's suggestion.
   */

  let rows = $state<ExtensionCommandRow[]>([]);
  let loaded = $state(false);
  let capturing = $state<string | null>(null);
  let problem = $state<{ key: string; message: string } | null>(null);

  const keyOf = (row: ExtensionCommandRow) => `${row.extensionId}\n${row.command}`;

  async function refresh(): Promise<void> {
    rows = await api.extensions.shortcuts().catch(() => []);
    loaded = true;
  }

  $effect(() => {
    void refresh();
    const offChanged = api.extensions.onChanged(() => void refresh());
    const offKey = api.settings.onShortcutKey(onPress);
    return () => {
      offChanged();
      offKey();
      stopCapture();
    };
  });

  const groups = $derived.by(() => {
    const byExtension = new Map<string, { name: string; rows: ExtensionCommandRow[] }>();
    for (const row of rows) {
      const group = byExtension.get(row.extensionId) ?? { name: row.extensionName, rows: [] };
      group.rows.push(row);
      byExtension.set(row.extensionId, group);
    }
    return [...byExtension.entries()];
  });

  function startCapture(row: ExtensionCommandRow): void {
    if (browser.isPrivate) return;
    if (capturing === keyOf(row)) return stopCapture();
    problem = null;
    capturing = keyOf(row);
    api.settings.captureShortcut(true);
  }

  function stopCapture(): void {
    if (capturing) api.settings.captureShortcut(false);
    capturing = null;
  }

  async function assign(row: ExtensionCommandRow, accelerator: string | null): Promise<void> {
    const result = await api.extensions.setShortcut(row.extensionId, row.command, accelerator).catch(() => ({ ok: false as const, issue: { kind: "invalid" } as ShortcutIssue }));
    if (!result.ok) {
      problem = { key: keyOf(row), message: shortcutIssueText(result.issue, "refusal") };
      return;
    }
    problem = null;
    stopCapture();
    await refresh();
  }

  function onPress(press: KeyPress): void {
    const row = rows.find((candidate) => keyOf(candidate) === capturing);
    if (!row) return;
    const bare = !press.control && !press.alt && !press.meta && !press.shift;
    if (bare && press.key === "Escape") return stopCapture();
    if (bare && (press.key === "Backspace" || press.key === "Delete")) return void assign(row, "");
    const accelerator = acceleratorFromKeyPress(press, platform.name);
    if (accelerator) void assign(row, accelerator);
  }

  function onKeydown(event: KeyboardEvent): void {
    // Main normally swallows the presses while capturing (onShortcutKey); this covers the rest.
    if (!capturing) return;
    event.preventDefault();
    event.stopPropagation();
    onPress({ key: event.key, code: event.code, control: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, meta: event.metaKey });
  }
</script>

<svelte:window onkeydowncapture={onKeydown} />

<section class="shortcuts" data-testid="extension-shortcut-editor" aria-labelledby="extension-shortcuts-title">
  <h2 id="extension-shortcuts-title"><Icon name="keyboard" size={14} /> {t("extensionShortcutsEditor.title")}</h2>
  <p class="help">
    {t("extensionShortcutsEditor.help")} <kbd>{t("shortcutsSection.esc")}</kbd> {t("shortcutsSection.cancels")}
    <kbd>{platform.isMac ? "⌫" : t("shortcutsSection.backspace")}</kbd> {t("shortcutsSection.removesShortcut")}
  </p>
  {#if groups.length}
    <Card>
      {#each groups as [extensionId, group] (extensionId)}
        <div class="group" role="group" aria-label={group.name}>
          <h3>{group.name}</h3>
          {#each group.rows as row (row.command)}
            {@const key = keyOf(row)}
            {@const id = `ext-shortcut-${extensionId}-${row.command}`}
            <div class="row" data-extension-id={extensionId} data-command={row.command}>
              <span class="label" {id}>{row.description || row.command}</span>
              <span class="control">
                {#if row.custom && !browser.isPrivate}
                  <IconButton
                    size="row"
                    icon="reset"
                    iconSize={12}
                    title={t("extensionShortcutsEditor.restoreSuggested")}
                    label={t("extensionShortcutsEditor.restoreSuggested")}
                    aria-describedby={id}
                    onclick={() => void assign(row, null)}
                  />
                {/if}
                <button
                  class="keys"
                  class:capturing={capturing === key}
                  class:off={!row.active}
                  disabled={browser.isPrivate}
                  aria-label={t("shortcutsSection.changeShortcut")}
                  aria-describedby={id}
                  aria-pressed={capturing === key}
                  onclick={() => startCapture(row)}
                  onblur={() => capturing === key && stopCapture()}
                >
                  {#if capturing === key}
                    {t("shortcutsSection.pressCombination")}
                  {:else if row.accelerator && row.issue?.kind !== "invalid"}
                    {#each acceleratorKeys(row.accelerator, platform.name) as part, index (index)}<kbd>{part}</kbd>{/each}
                  {:else}
                    <span class="none">{t("extensionRow.noShortcut")}</span>
                  {/if}
                </button>
              </span>
              {#if problem?.key === key}
                <p class="note" role="alert"><Icon name="warning" size={12} /> {problem.message}</p>
              {:else if row.issue && row.accelerator}
                <p class="note"><Icon name="warning" size={12} /> {shortcutIssueText(row.issue)}</p>
              {/if}
            </div>
          {/each}
        </div>
      {/each}
    </Card>
  {:else if loaded}
    <EmptyState icon="keyboard" title={t("extensionShortcutsEditor.none")} />
  {/if}
</section>

<style>
  .shortcuts {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  h2 {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    font-size: var(--text-md);
  }
  .help {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
  .group + .group {
    border-top: 1px solid var(--border);
  }
  h3 {
    margin: var(--space-3) var(--space-4) var(--space-1);
    color: var(--text-faint);
    font-size: var(--text-xs);
    font-weight: 600;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-4);
    min-height: var(--hit-min);
    padding: var(--space-1) var(--space-4);
  }
  .label {
    flex: 1 1 160px;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .control {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-left: auto;
  }
  .keys {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    min-width: 96px;
    height: 30px;
    padding: 0 var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    white-space: nowrap;
    transition: border-color var(--motion-fast) ease;
  }
  .keys:hover:not(:disabled) {
    background: var(--surface-hover);
  }
  .keys.off kbd {
    opacity: 0.55;
    text-decoration: line-through;
  }
  .keys.capturing {
    border-color: var(--accent);
    color: var(--accent-text);
    font-size: var(--text-xs);
  }
  .none {
    color: var(--text-faint);
    font-size: var(--text-xs);
  }
  kbd {
    min-width: 20px;
    padding: 1px var(--space-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-elevated);
    font: inherit;
    font-size: var(--text-xs);
    text-align: center;
  }
  .note {
    display: flex;
    flex-basis: 100%;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
</style>
