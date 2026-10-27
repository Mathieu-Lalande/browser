import { commandShortcut, withShortcut, type CommandId } from "@shared/commands";

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

  /** "Nouvel onglet (Ctrl+T)": tooltips built from the command registry. */
  tip(label: string, id: CommandId): string {
    return withShortcut(label, id, this.name);
  }

  shortcut(id: CommandId): string {
    return commandShortcut(id, this.name);
  }
}

export const platform = new PlatformStore();
