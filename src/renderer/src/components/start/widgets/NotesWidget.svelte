<script lang="ts">
  import { t } from "@shared/i18n";
  import { LIMITS } from "@shared/start-widgets";
  import { browser } from "../../../lib/browser.svelte";
  import type { WidgetProps } from "../types";

  let { widget, layout }: WidgetProps<"notes"> = $props();
</script>

<h2 class="widget-title">{t("notesWidget.notes")}</h2>
<textarea
  aria-label={t("notesWidget.quickNotes")}
  placeholder={browser.isPrivate ? t("notesWidget.notesNotKeptPrivate") : t("notesWidget.ideaAddressList")}
  maxlength={LIMITS.notes}
  value={widget.options.text}
  oninput={(event) => layout.setOptions(widget.id, { text: event.currentTarget.value }, true)}
></textarea>

<style>
  textarea {
    flex: 1;
    width: 100%;
    min-height: 110px;
    padding: var(--space-2) var(--space-3);
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    outline: 0;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: var(--text-sm);
    line-height: 1.5;
    resize: none;
    user-select: text;
  }
  textarea:focus {
    border-color: color-mix(in oklab, var(--accent) 50%, transparent);
  }
</style>
