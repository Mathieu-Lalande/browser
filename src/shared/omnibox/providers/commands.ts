import { COMMANDS, commandLabel, isCommandAvailable } from "../../commands";
import { settingUrl } from "../settings-index";
import type { Provider, QueryContext, Suggestion } from "../types";
import { matchedRow, present } from "./util";

/** Browser commands from the shared registry, with their effective shortcut (ADR-028). */
export class CommandsProvider implements Provider {
  readonly id = "commands";
  readonly scope = "commands" as const;

  query(text: string, context: QueryContext): Suggestion[] {
    const filter = context.commandFilter ?? (() => true);
    return present(
      COMMANDS.filter((command) => isCommandAvailable(command, context.commandContext) && filter(command, !text)).map((command) =>
        matchedRow(
          text,
          "commands",
          {
            key: `command:${command.id}`,
            title: commandLabel(command, context.commandContext),
            detail: "",
            icon: "command",
            shortcut: context.shortcut?.(command.id) ?? [],
            verb: "Exécuter",
            completion: commandLabel(command, context.commandContext),
            action: { type: "command", command },
          },
          { keywords: command.keywords },
        ),
      ),
    );
  }
}

/** Rows of `browser://settings`, each a deep link to the row (`#section/row`). */
export class SettingsProvider implements Provider {
  readonly id = "settings";
  readonly scope = "settings" as const;

  query(text: string, context: QueryContext): Suggestion[] {
    if (!text && !context.scope) return [];
    return present(
      context.settings.map((entry) =>
        matchedRow(
          text,
          "settings",
          {
            key: `setting:${entry.anchor}`,
            title: entry.label,
            detail: `Paramètres › ${entry.section}`,
            icon: "settings",
            verb: "Afficher le réglage",
            completion: entry.label,
            action: { type: "open", url: settingUrl(entry) },
          },
          { keywords: [entry.section, ...entry.keywords] },
        ),
      ),
    );
  }
}
