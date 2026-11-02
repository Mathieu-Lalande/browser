<script lang="ts">
  import type { CommandDefinition } from "@shared/commands";
  import Icon from "../../components/Icon.svelte";

  /** Confirmation of a destructive command, in place of the results. */
  let { command, onConfirm, onCancel }: { command: CommandDefinition; onConfirm: () => void; onCancel: () => void } = $props();
</script>

<div class="confirm" role="alertdialog" aria-labelledby="confirm-title" aria-describedby="confirm-detail">
  <span class="confirm-icon"><Icon name={command.icon} size={20} /></span>
  <h2 id="confirm-title">{command.confirm?.title}</h2>
  <p id="confirm-detail">{command.confirm?.detail}</p>
  <div class="buttons">
    <!-- The safe choice has the focus: Enter never destroys by accident. -->
    <!-- svelte-ignore a11y_autofocus -->
    <button class="button" autofocus onclick={onCancel}>Annuler</button>
    <button class="button danger" onclick={onConfirm}>{command.confirm?.action}</button>
  </div>
</div>

<style>
  .confirm {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 28px 28px 22px;
    text-align: center;
  }
  .confirm-icon {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    margin-bottom: 14px;
    border-radius: 12px;
    background: rgb(239 68 68 / 0.14);
    color: #ef4444;
  }
  h2 {
    margin: 0 0 6px;
    font-size: 16px;
    font-weight: 600;
  }
  p {
    max-width: 420px;
    margin: 0 0 20px;
    color: var(--text-muted);
  }
  .buttons {
    display: flex;
    gap: 8px;
  }
  .button {
    height: 34px;
    padding: 0 16px;
    border-radius: 9px;
    background: var(--surface-hover);
  }
  .button:hover {
    background: var(--surface-active);
  }
  .button.danger {
    background: #dc2626;
    color: #fff;
  }
  .button.danger:hover {
    background: #b91c1c;
  }
</style>
