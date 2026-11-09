<script lang="ts">
  import { t } from "@shared/i18n";
  import { acceleratorFromKeyPress, type KeyPress } from "@shared/accelerators";
  import {
    COMMAND_GROUPS,
    assignShortcut,
    checkShortcut,
    effectiveAccelerator,
    getCommand,
    resetShortcut,
    shortcutKeys,
    shortcutText,
    type CommandId,
    type ShortcutCheck,
  } from "@shared/commands";
  import { api } from "../../lib/browser.svelte";
  import { platform } from "../../lib/platform.svelte";
  import { settings } from "../../lib/settings.svelte";
  import Icon from "../Icon.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import ConfirmButton from "../ui/ConfirmButton.svelte";

  /**
   * "Raccourcis clavier" (ADR-028): every registry command with its effective shortcut. Clicking
   * one captures the next combination (main swallows it so no menu accelerator fires), checks it,
   * and asks before taking it from another command.
   */

  const overrides = $derived(settings.current.shortcuts);
  let query = $state("");
  let capturing = $state<CommandId | null>(null);
  let problem = $state<{ id: CommandId; message: string } | null>(null);
  let pending = $state<{ id: CommandId; accelerator: string; conflict: CommandId } | null>(null);

  const labelOf = (id: CommandId) => getCommand(id).label;
  const keysOf = (id: CommandId) => {
    const accelerator = effectiveAccelerator(id, platform.name, overrides);
    return accelerator ? shortcutKeys(accelerator, platform.name) : [];
  };

  const normalize = (text: string) =>
    text
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();

  const groups = $derived.by(() => {
    const words = normalize(query).split(/\s+/).filter(Boolean);
    return COMMAND_GROUPS.map((group) => ({
      label: group.label,
      ids: group.ids.filter((id) => {
        const command = getCommand(id);
        const accelerator = effectiveAccelerator(id, platform.name, overrides);
        const haystack = normalize([command.label, ...command.keywords, accelerator ? shortcutText(accelerator, platform.name) : ""].join(" "));
        return words.every((word) => haystack.includes(word));
      }),
    })).filter((group) => group.ids.length > 0);
  });

  function save(next: typeof overrides): void {
    settings.update({ shortcuts: next });
  }

  function startCapture(id: CommandId): void {
    if (capturing === id) return stopCapture();
    pending = null;
    problem = null;
    capturing = id;
    api.settings.captureShortcut(true);
  }

  function stopCapture(): void {
    if (capturing) api.settings.captureShortcut(false);
    capturing = null;
  }

  function refusal(check: Exclude<ShortcutCheck, { ok: true }>): string {
    switch (check.reason) {
      case "needs-modifier":
        return t(platform.isMac ? "shortcutsSection.needsModifierMac" : "shortcutsSection.needsModifier");
      case "reserved":
        return t("shortcutsSection.combinationReservedSystem");
      case "fixed":
        return t("shortcutsSection.alreadyUsedWhichCant", { label: check.label });
      default:
        return t("shortcutsSection.keyCantUsedShortcut");
    }
  }

  function onPress(press: KeyPress): void {
    const id = capturing;
    if (!id) return;
    const bare = !press.control && !press.alt && !press.meta && !press.shift;
    if (bare && press.key === "Escape") return stopCapture();
    if (bare && (press.key === "Backspace" || press.key === "Delete")) {
      stopCapture();
      return save(assignShortcut(overrides, id, null, platform.name));
    }
    const accelerator = acceleratorFromKeyPress(press, platform.name);
    if (!accelerator) return; // Modifiers only, so far.
    const check = checkShortcut(id, accelerator, platform.name, overrides);
    if (!check.ok) {
      problem = { id, message: refusal(check) };
      return;
    }
    problem = null;
    stopCapture();
    if (check.conflict) pending = { id, accelerator: check.accelerator, conflict: check.conflict };
    else save(assignShortcut(overrides, id, check.accelerator, platform.name));
  }

  function replace(): void {
    if (!pending) return;
    save(assignShortcut(overrides, pending.id, pending.accelerator, platform.name));
    pending = null;
  }

  function onKeydown(event: KeyboardEvent): void {
    // Main normally swallows the presses while capturing (onShortcutKey); this covers the rest.
    if (!capturing) return;
    event.preventDefault();
    event.stopPropagation();
    onPress({ key: event.key, code: event.code, control: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, meta: event.metaKey });
  }

  $effect(() => {
    const unsubscribe = api.settings.onShortcutKey(onPress);
    return () => {
      unsubscribe();
      stopCapture();
    };
  });
</script>

<svelte:window onkeydowncapture={onKeydown} />

<div class="toolbar">
  <label class="search">
    <Icon name="search" size={14} />
    <input type="search" placeholder={t("shortcutsSection.searchCommand")} aria-label={t("shortcutsSection.searchShortcut")} bind:value={query} />
  </label>
  <ConfirmButton question={t("shortcutsSection.allDefaultShortcuts")} confirmLabel={t("shortcutsSection.reset")} onconfirm={() => ((pending = null), save({}))}>
    <Icon name="reset" size={12} /> {t("shortcutsSection.resetAll")}
  </ConfirmButton>
</div>
<p class="help">
  {t("shortcutsSection.clickShortcutThenPress")} <kbd>{t("shortcutsSection.esc")}</kbd> {t("shortcutsSection.cancels")}
  <kbd>{platform.isMac ? "⌫" : t("shortcutsSection.backspace")}</kbd> {t("shortcutsSection.removesShortcut")}
</p>

{#each groups as group (group.label)}
  <div class="group" role="group" aria-label={group.label}>
    <h3>{group.label}</h3>
    {#each group.ids as id (id)}
      {@const keys = keysOf(id)}
      {@const custom = Object.hasOwn(overrides, id)}
      <!-- The buttons are described (not named) by the command: their names stay apart from the
           chrome's own buttons ("Nouvel onglet"…), which the settings page sits next to. -->
      <div class="shortcut" data-command={id}>
        <span class="label" id="shortcut-{id}">{labelOf(id)}</span>
        <div class="control">
          {#if custom}
            <IconButton
              size="row"
              icon="reset"
              iconSize={12}
              title={t("shortcutsSection.defaultShortcut")}
              label={t("shortcutsSection.restoreDefaultShortcut")}
              aria-describedby="shortcut-{id}"
              onclick={() => ((pending = null), save(resetShortcut(overrides, id)))}
            />
          {/if}
          <button
            class="keys"
            class:capturing={capturing === id}
            class:custom
            aria-label={t("shortcutsSection.changeShortcut")}
            aria-describedby="shortcut-{id}"
            aria-pressed={capturing === id}
            onclick={() => startCapture(id)}
            onblur={() => capturing === id && stopCapture()}
          >
            {#if capturing === id}
              {t("shortcutsSection.pressCombination")}
            {:else if keys.length}
              {#each keys as key, index (index)}<kbd>{key}</kbd>{/each}
            {:else}
              <span class="none">{t("shortcutsSection.none")}</span>
            {/if}
          </button>
        </div>
        {#if problem?.id === id && capturing === id}
          <p class="note" role="status"><Icon name="warning" size={12} /> {problem.message}</p>
        {/if}
        {#if pending?.id === id}
          {@const taken = pending}
          <div class="note conflict" role="alert">
            <Icon name="warning" size={12} />
            <span class="message">
              {t("shortcutsSection.alreadyUsed", { p: shortcutText(taken.accelerator, platform.name), p2: labelOf(taken.conflict) })}
            </span>
            <span class="actions">
              <button class="action" onclick={() => (pending = null)}>{t("shortcutsSection.cancel")}</button>
              <button class="action primary" onclick={replace}>{t("shortcutsSection.replace")}</button>
            </span>
          </div>
        {/if}
      </div>
    {/each}
  </div>
{:else}
  <p class="empty">{t("shortcutsSection.noCommandMatches")}</p>
{/each}

<style>
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    padding: 12px 18px 0;
  }
  .search {
    display: flex;
    flex: 1 1 200px;
    align-items: center;
    gap: 8px;
    min-width: 0;
    height: 32px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    color: var(--text-muted);
  }
  .search:focus-within {
    border-color: var(--accent);
  }
  .search input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: 0;
    background: none;
    color: var(--text);
    font: inherit;
  }
  .help {
    margin: 8px 18px 4px;
    color: var(--text-muted);
    font-size: 12px;
  }
  .group {
    padding: 4px 0;
  }
  .group + .group {
    border-top: 1px solid var(--border);
  }
  h3 {
    margin: 10px 18px 2px;
    color: var(--text-faint);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .shortcut {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 6px 16px;
    min-height: 40px;
    padding: 4px 18px;
  }
  .label {
    flex: 1 1 160px;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .control {
    display: flex;
    flex: none;
    align-items: center;
    gap: 6px;
    margin-left: auto;
  }
  .keys {
    display: flex;
    align-items: center;
    gap: 3px;
    min-width: 96px;
    height: 30px;
    padding: 0 8px;
    justify-content: center;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    white-space: nowrap;
  }
  .keys:hover {
    background: var(--surface-hover);
  }
  .keys.custom {
    border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
  }
  .keys.capturing {
    border-color: var(--accent);
    color: var(--accent-text);
    font-size: 12px;
    box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent) 25%, transparent);
  }
  .none {
    color: var(--text-faint);
    font-size: 12px;
  }
  kbd {
    min-width: 20px;
    padding: 1px 5px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--bg-elevated);
    font: inherit;
    font-size: 11px;
    text-align: center;
  }
  .note {
    display: flex;
    flex-basis: 100%;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 8px;
    margin: 0;
    color: var(--text-muted);
    font-size: 12px;
  }
  .conflict {
    padding: 8px 10px;
    border: 1px solid color-mix(in oklab, var(--accent) 35%, var(--border));
    border-radius: 8px;
    background: color-mix(in oklab, var(--accent) 8%, transparent);
    color: var(--text);
  }
  .message {
    flex: 1 1 200px;
    min-width: 0;
  }
  .actions {
    display: flex;
    gap: 6px;
    margin-left: auto;
  }
  .action {
    height: 28px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: var(--surface);
  }
  .action:hover {
    background: var(--surface-hover);
  }
  .action.primary {
    border-color: transparent;
    background: var(--accent);
    color: var(--on-accent);
  }
  .empty {
    margin: 0;
    padding: 18px;
    color: var(--text-muted);
    font-size: 13px;
    text-align: center;
  }
</style>
