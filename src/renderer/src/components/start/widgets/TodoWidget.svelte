<script lang="ts">
  import { t } from "@shared/i18n";
  import { LIMITS, addTodo, clearDoneTodos, removeTodo, toggleTodo, type TodoItem } from "@shared/start-widgets";
  import Checkbox from "../../ui/Checkbox.svelte";
  import IconButton from "../../ui/IconButton.svelte";
  import type { WidgetProps } from "../types";

  let { widget, layout }: WidgetProps<"todo"> = $props();
  let draft = $state("");

  const items = $derived(widget.options.items);
  const shown = $derived(widget.options.hideDone ? items.filter((item) => !item.done) : items);
  const done = $derived(items.filter((item) => item.done).length);

  const save = (next: TodoItem[]) => layout.setOptions(widget.id, { items: next });

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    if (!draft.trim()) return;
    save(addTodo(items, draft));
    draft = "";
  }
</script>

<h2 class="widget-title">{t("todoWidget.do")} {#if items.length}<span class="count">{done}/{items.length}</span>{/if}</h2>
<form onsubmit={submit}>
  <input class="ui-field" bind:value={draft} maxlength={LIMITS.todoText} placeholder={t("todoWidget.addTask")} aria-label={t("todoWidget.newTask")} disabled={items.length >= LIMITS.todoItems} />
</form>
<ul>
  {#each shown as item (item.id)}
    <li class:done={item.done}>
      <Checkbox checked={item.done} onchange={() => save(toggleTodo(items, item.id))}>{item.text}</Checkbox>
      <IconButton icon="close" size="sm" label={t("todoWidget.delete", { text: item.text })} onclick={() => save(removeTodo(items, item.id))} />
    </li>
  {/each}
</ul>
{#if done > 0}
  <button class="clear" onclick={() => save(clearDoneTodos(items))}>{t("todoWidget.clearCompletedTasks")}</button>
{/if}

<style>
  .count {
    margin-left: var(--space-1);
    color: var(--text-faint);
    font-weight: 500;
  }
  form input {
    width: 100%;
  }
  ul {
    display: grid;
    gap: 2px;
    margin: var(--space-2) 0 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    min-height: var(--hit-min);
    padding: 0 0 0 var(--space-1);
    font-size: var(--text-sm);
  }
  li.done :global(.label) {
    color: var(--text-faint);
    text-decoration: line-through;
  }
  li :global(.icon-button) {
    opacity: 0;
  }
  li:hover :global(.icon-button),
  li:focus-within :global(.icon-button) {
    opacity: 1;
  }
  .clear {
    align-self: flex-start;
    margin-top: var(--space-2);
    padding: 2px var(--space-1);
    color: var(--text-faint);
    font-size: var(--text-xs);
  }
  .clear:hover {
    color: var(--text);
  }
</style>
