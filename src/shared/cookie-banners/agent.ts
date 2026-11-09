import type { CookieBannerRule } from "./rules";

/**
 * The cookie banner agent (ADR-046): applies the rules to a page through a small DOM port. Main
 * runs it in an isolated world (the port is then backed by `document`); tests run it on fixtures.
 *
 * `cookieBannerAgent` must stay self-contained (no import, no module-level reference, nothing
 * but ES2018 and its parameters): main sends its source text (`String(cookieBannerAgent)`) to the
 * page. A unit test checks that the source evaluates on its own.
 */

/** What the agent needs from a page. `E` is an element. */
export interface BannerDom<E> {
  /** Elements matching a selector list; `host >>> inner` looks inside `host`'s open shadow root. */
  query(selector: string): E[];
  visible(element: E): boolean;
  /** The element's label: its text, `aria-label`, `title` or `value`. */
  label(element: E): string;
  click(element: E): void;
  /** Hides `selectors` (and releases the scroll lock of `unlock`) with a style sheet. */
  hide(selectors: string[], unlock: string[]): void;
  /** Resolves when the document changes, or after `ms` at the latest. */
  changed(ms: number): Promise<void>;
  now(): number;
}

export interface AgentOptions {
  /** How long to watch the page for a banner that shows up late (ms). */
  watchMs: number;
  /** How long a step waits for its button (ms). */
  stepMs: number;
}

export type BannerOutcome = "rejected" | "hidden" | "failed" | "none";

export interface BannerResult {
  /** The CMP recognized, if any. */
  cmp: string | null;
  outcome: BannerOutcome;
}

export const DEFAULT_AGENT_OPTIONS: AgentOptions = { watchMs: 10_000, stepMs: 2_000 };

export function cookieBannerAgent<E>(rules: readonly CookieBannerRule[], dom: BannerDom<E>, options: AgentOptions): Promise<BannerResult> {
  // Labels of refusals, and of acceptances (never clicked, whatever a rule says).
  const REJECT =
    /(refus|reject|rejeter|decline|deny|disagree|sans accepter|without (accept|agree)|nécessaires? uniquement|only (necessary|essential)|essentiels? uniquement|continuer sans|ne pas (accepter|autoriser|consentir)|do not (accept|consent)|non merci|no,? thanks|rechazar|ablehnen|rifiuta)/i;
  const ACCEPT = /(accept|agree|autoriser|allow|consent|j'accepte|ok,? (pour moi|got it)|akzeptieren|aceptar|accetta|zustimmen)/i;

  const visibleIn = (selector: string): E[] => dom.query(selector).filter((element) => dom.visible(element));
  const looksLikeRejection = (element: E): boolean => REJECT.test(dom.label(element));
  const looksLikeAcceptance = (element: E): boolean => {
    const label = dom.label(element);
    return ACCEPT.test(label) && !REJECT.test(label);
  };
  const anyVisible = (selectors: readonly string[]): boolean => selectors.some((selector) => visibleIn(selector).length > 0);

  const pick = (step: CookieBannerRule["strategies"][number][number]): E | undefined => {
    const found = visibleIn(step.click);
    return step.requireReject ? found.find(looksLikeRejection) : found[0];
  };

  /** The step's element, waiting for it to show up for at most `options.stepMs`. */
  const waitFor = async (step: CookieBannerRule["strategies"][number][number]): Promise<E | undefined> => {
    const end = dom.now() + options.stepMs;
    for (;;) {
      const element = pick(step);
      if (element || dom.now() >= end) return element;
      await dom.changed(Math.min(250, Math.max(0, end - dom.now())));
    }
  };

  /** Runs a strategy; false when a required step finds nothing, or would accept. */
  const tryStrategy = async (steps: CookieBannerRule["strategies"][number]): Promise<boolean> => {
    for (let index = 0; index < steps.length; index++) {
      const step = steps[index];
      // The first step decides whether the strategy applies: no waiting for it.
      const element = index === 0 ? pick(step) : await waitFor(step);
      if (!element) {
        if (step.optional) continue;
        return false;
      }
      if (looksLikeAcceptance(element)) return false;
      dom.click(element);
    }
    return true;
  };

  /** Whether the banner went away within a step's delay. */
  const dismissed = async (rule: CookieBannerRule): Promise<boolean> => {
    const end = dom.now() + options.stepMs;
    while (anyVisible(rule.banner)) {
      if (dom.now() >= end) return false;
      await dom.changed(Math.min(250, end - dom.now()));
    }
    return true;
  };

  const apply = async (rule: CookieBannerRule): Promise<BannerResult> => {
    for (const steps of rule.strategies) {
      if ((await tryStrategy(steps)) && (await dismissed(rule))) return { cmp: rule.id, outcome: "rejected" };
    }
    if (!rule.hide.length) return { cmp: rule.id, outcome: "failed" };
    dom.hide(rule.hide, rule.unlock ?? []);
    return { cmp: rule.id, outcome: "hidden" };
  };

  const run = async (): Promise<BannerResult> => {
    const deadline = dom.now() + options.watchMs;
    let seen: string | null = null;
    for (;;) {
      const rule = rules.find((candidate) => candidate.detect.some((selector) => dom.query(selector).length > 0));
      if (rule) {
        seen = rule.id;
        if (anyVisible(rule.banner)) return apply(rule);
      }
      const left = deadline - dom.now();
      if (left <= 0) return { cmp: seen, outcome: "none" };
      await dom.changed(Math.min(1_000, left));
    }
  };

  return run();
}
