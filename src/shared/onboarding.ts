/**
 * First-run onboarding (`browser://welcome`, ADR-043): five short steps, any of them skippable.
 * Pure: the page keeps a `WelcomeState` and moves it with these functions; main only decides
 * whether the page opens by itself at startup (`shouldOpenWelcome`).
 */

import type { CommandId } from "./commands";

export const WELCOME_STEPS = ["hello", "theme", "import", "default", "essentials"] as const;

export type WelcomeStep = (typeof WELCOME_STEPS)[number];

export const WELCOME_STEP_LABELS: Record<WelcomeStep, string> = {
  hello: "Bienvenue",
  theme: "Thème",
  import: "Importer",
  default: "Navigateur par défaut",
  essentials: "L'essentiel",
};

/** The "découvrir l'essentiel" cards, each with a looping illustration (`id`). */
export interface WelcomeTipDefinition {
  id: "omnibox" | "spaces" | "peek" | "compact";
  title: string;
  text: string;
  /** Its shortcut comes from this command (`effectiveAccelerator`: the user's own shortcut). */
  command?: CommandId;
  /** A gesture rather than a shortcut ("Maj + clic"). */
  gesture?: string;
}

export const WELCOME_TIPS: readonly WelcomeTipDefinition[] = [
  { id: "omnibox", title: "Barre universelle", text: "Onglets, historique, favoris, commandes et calculs au même endroit.", command: "command-palette" },
  {
    id: "spaces",
    title: "Espaces",
    text: "Un espace par contexte (travail, perso…). Glissez à deux doigts sur la barre latérale pour passer de l'un à l'autre.",
    gesture: "Deux doigts",
  },
  { id: "peek", title: "Aperçu de lien", text: "Un lien s'ouvre dans une carte au-dessus de la page, sans la quitter.", gesture: "Maj + clic" },
  { id: "compact", title: "Mode compact", text: "La barre latérale se replie en rail pour laisser toute la place aux pages.", command: "toggle-compact-mode" },
];

export type WelcomeTip = WelcomeTipDefinition["id"];

export interface WelcomeState {
  step: WelcomeStep;
  /** Steps the user went through (finished or passed). */
  seen: readonly WelcomeStep[];
}

export const initialWelcome = (): WelcomeState => ({ step: "hello", seen: [] });

export const welcomeIndex = (step: WelcomeStep): number => WELCOME_STEPS.indexOf(step);

export const isLastStep = (state: WelcomeState): boolean => welcomeIndex(state.step) === WELCOME_STEPS.length - 1;

const mark = (seen: readonly WelcomeStep[], step: WelcomeStep) => (seen.includes(step) ? seen : [...seen, step]);

/** The next step; `null` once past the last one (the onboarding is finished). */
export function nextWelcome(state: WelcomeState): WelcomeState | null {
  const index = welcomeIndex(state.step);
  if (index >= WELCOME_STEPS.length - 1) return null;
  return { step: WELCOME_STEPS[index + 1], seen: mark(state.seen, state.step) };
}

export function previousWelcome(state: WelcomeState): WelcomeState {
  const index = welcomeIndex(state.step);
  return index <= 0 ? state : { ...state, step: WELCOME_STEPS[index - 1] };
}

/** Jumps to a step (the dots): any one, the steps being independent. */
export function goToWelcome(state: WelcomeState, step: WelcomeStep): WelcomeState {
  return { step, seen: mark(state.seen, state.step) };
}

/** Arrow keys move between steps; Escape skips the whole onboarding. */
export function welcomeKeyAction(key: string): "next" | "previous" | "skip" | null {
  if (key === "ArrowRight" || key === "PageDown") return "next";
  if (key === "ArrowLeft" || key === "PageUp") return "previous";
  if (key === "Escape") return "skip";
  return null;
}

/**
 * Whether main opens the welcome page at startup: a profile that has not finished (or skipped) it,
 * never in a private window, and not when the profile picker or a crash recovery comes first.
 */
export function shouldOpenWelcome(context: { completed: boolean; suppressed?: boolean; otherPageFirst?: boolean }): boolean {
  return !context.completed && !context.suppressed && !context.otherPageFirst;
}

/** The longest transition of the welcome page, in ms (ADR-043: it must feel instant). */
export const WELCOME_TRANSITION_MS = 160;
