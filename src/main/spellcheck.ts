import { intlLocale } from "@shared/i18n";
import type { Session } from "electron";
import type { Settings } from "@shared/settings";
import { spellLanguagesFor } from "@shared/spellcheck";
import type { SessionOptions, SessionService } from "./services";

export interface SpellcheckDeps {
  settings(): Settings;
  onSettingsChanged(listener: (current: Settings) => void): unknown;
  /** The app's locale (intlLocale()), the default dictionary. */
  locale(): string;
  platform: string;
}

/**
 * Spell checking (ADR-041), installed into each tab session by `SessionHardener`: the chosen
 * dictionaries (Windows and Linux: macOS uses the system checker and its own languages), and the
 * custom words, kept the same in every profile session (default session, isolated spaces). A
 * private window's session gets its words too, but what is added there stays in it (ADR-014).
 */
export class SpellcheckService implements SessionService {
  private readonly sessions = new Map<Session, { ephemeral: boolean }>();
  private following = false;

  constructor(private readonly deps: SpellcheckDeps) {}

  install(ses: Session, options: SessionOptions = {}): void {
    if (this.sessions.has(ses)) return;
    this.sessions.set(ses, { ephemeral: !!options.ephemeral });
    this.apply(ses);
    if (!this.following) {
      this.following = true;
      let previous = JSON.stringify(this.deps.settings().spellcheck);
      this.deps.onSettingsChanged((current) => {
        const next = JSON.stringify(current.spellcheck);
        if (next === previous) return;
        previous = next;
        for (const known of this.sessions.keys()) this.apply(known);
      });
    }
  }

  release(ses: Session): void {
    this.sessions.delete(ses);
  }

  /** Dictionaries Chromium can load (it downloads them on first use), empty on macOS. */
  available(): string[] {
    if (this.deps.platform === "darwin") return [];
    return this.anySession()?.availableSpellCheckerLanguages ?? [];
  }

  /** What is in use now (the setting, or the locale's dictionary when none is chosen). */
  current(): string[] {
    return this.anySession()?.getSpellCheckerLanguages() ?? [];
  }

  async words(): Promise<string[]> {
    const ses = this.profileSessions()[0];
    return ses ? (await ses.listWordsInSpellCheckerDictionary()).sort((a, b) => a.localeCompare(b, intlLocale())) : [];
  }

  /** "Ajouter au dictionnaire": every profile session, or only `from` when it is private. */
  addWord(word: string, from?: Session): void {
    const targets = from && this.sessions.get(from)?.ephemeral ? [from] : this.profileSessions();
    for (const ses of targets) ses.addWordToSpellCheckerDictionary(word);
  }

  removeWord(word: string): void {
    for (const ses of this.sessions.keys()) ses.removeWordFromSpellCheckerDictionary(word);
  }

  private apply(ses: Session): void {
    const { enabled, languages } = this.deps.settings().spellcheck;
    ses.setSpellCheckerEnabled(enabled);
    if (!enabled || this.deps.platform === "darwin") return;
    const chosen = spellLanguagesFor(languages, ses.availableSpellCheckerLanguages, this.deps.locale());
    if (chosen.length) ses.setSpellCheckerLanguages(chosen);
  }

  private profileSessions(): Session[] {
    return [...this.sessions].filter(([, info]) => !info.ephemeral).map(([ses]) => ses);
  }

  private anySession(): Session | undefined {
    return this.profileSessions()[0] ?? this.sessions.keys().next().value;
  }
}
