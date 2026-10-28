import { commandShortcut, effectiveAccelerator, shortcutKeys, withShortcut, type CommandId } from "@shared/commands";
import { settings } from "./settings.svelte";

/**
 * The OS the chrome UI is laid out for (`window.platform`, from the preload), mirrored on
 * `<html data-platform>`. Reactive to that attribute, so a test can lay the UI out as on macOS
 * (traffic lights instead of drawn window controls) on any OS.
 */
class PlatformStore {
  name = $state(window.platform);
  isMac: boolean = $derived(this.name === "darwin");

  constructor() {
    const root = document.documentElement;
    root.dataset.platform = this.name;
    new MutationObserver(() => {
      if (root.dataset.platform && root.dataset.platform !== this.name) this.name = root.dataset.platform;
    }).observe(root, { attributes: true, attributeFilter: ["data-platform"] });
  }

  /** "Nouvel onglet (Ctrl+T)": tooltips from the command registry and the user's shortcuts (ADR-028). */
  tip(label: string, id: CommandId): string {
    return withShortcut(label, id, this.name, settings.current.shortcuts);
  }

  shortcut(id: CommandId): string {
    return commandShortcut(id, this.name, settings.current.shortcuts);
  }

  /** The command's effective shortcut as keys to draw (`<kbd>`), none when it has no shortcut. */
  keys(id: CommandId): string[] {
    const accelerator = effectiveAccelerator(id, this.name, settings.current.shortcuts);
    return accelerator ? shortcutKeys(accelerator, this.name) : [];
  }
}

export const platform = new PlatformStore();
