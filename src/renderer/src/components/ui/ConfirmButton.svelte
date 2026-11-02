<script lang="ts">
  import type { Snippet } from "svelte";

  /**
   * A button whose action needs an inline confirmation: the first click swaps it for
   * "question · Annuler · confirm", with the focus on "Annuler" (Enter never destroys by
   * accident); Escape cancels.
   */
  let {
    question,
    confirmLabel,
    onconfirm,
    variant = "ghost",
    title,
    children,
  }: {
    question: string;
    confirmLabel: string;
    onconfirm: () => void;
    variant?: "ghost" | "outlined";
    title?: string;
    children: Snippet;
  } = $props();

  let confirming = $state(false);
  let cancel = $state<HTMLButtonElement>();
  let trigger = $state<HTMLButtonElement>();

  $effect(() => {
    if (confirming) cancel?.focus();
  });

  function close(refocus: boolean): void {
    confirming = false;
    if (refocus) queueMicrotask(() => trigger?.focus());
  }
</script>

{#if confirming}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <span
    class="confirm {variant}"
    role="group"
    aria-label={question}
    onkeydown={(event) => event.key === "Escape" && (event.preventDefault(), event.stopPropagation(), close(true))}
  >
    <span class="question">{question}</span>
    <button class="cancel" bind:this={cancel} onclick={() => close(true)}>Annuler</button>
    <button class="danger" onclick={() => (close(false), onconfirm())}>{confirmLabel}</button>
  </span>
{:else}
  <button class="trigger {variant}" {title} bind:this={trigger} onclick={() => (confirming = true)}>
    {@render children()}
  </button>
{/if}

<style>
  .trigger,
  .confirm button {
    display: flex;
    flex: none;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 10px;
    border-radius: 8px;
    font-size: 12px;
    white-space: nowrap;
  }
  .trigger.ghost {
    color: var(--text-muted);
  }
  .trigger.ghost:hover {
    background: var(--surface-hover);
    color: var(--text);
  }
  .trigger.outlined {
    height: 32px;
    padding: 0 12px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    font-size: inherit;
  }
  .trigger.outlined:hover {
    background: var(--surface-hover);
  }
  .confirm {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
    animation: appear 0.14s var(--ease);
  }
  .question {
    color: var(--text-muted);
    font-size: 12px;
  }
  .cancel {
    background: var(--surface-hover);
    color: var(--text);
  }
  .cancel:hover {
    background: var(--surface-active);
  }
  .danger {
    background: #e5484d;
    color: #fff;
    font-weight: 500;
  }
  .danger:hover {
    background: #d63c41;
  }
  .outlined button {
    height: 32px;
    padding: 0 12px;
    font-size: inherit;
  }
  @keyframes appear {
    from {
      opacity: 0;
      transform: translateX(4px);
    }
  }
</style>
