import type { Provider, QueryContext, Suggestion } from "../types";

/**
 * `@ia <question>` (ADR-044): asks the AI assistant, with or without the current page. Only when
 * the assistant is enabled, and only scoped: a question is never sent by typing in the bar alone.
 */
export class AssistantProvider implements Provider {
  readonly id = "assistant";
  readonly scope = "assistant" as const;

  query(text: string, context: QueryContext): Suggestion[] {
    if (context.scope !== "assistant" || !context.assistant || !text) return [];
    const question = text.slice(0, 4000);
    const row = (includePage: boolean, score: number): Suggestion => ({
      key: `assistant:${includePage ? "page" : "alone"}`,
      section: "assistant",
      title: question,
      titleRanges: [],
      detail: includePage ? "Demander à l'assistant, avec la page actuelle" : "Demander à l'assistant, sans envoyer la page",
      detailRanges: [],
      score,
      icon: "sparkles",
      verb: "Demander",
      action: { type: "assistant", question, includePage },
    });
    const withPage = context.assistant.pageAvailable && context.assistant.includePage;
    return context.assistant.pageAvailable ? [row(withPage, 2), row(!withPage, 1)] : [row(false, 2)];
  }
}
