<script lang="ts">
  import type { ExtensionReview } from "@shared/extensions";
  import { api } from "../lib/browser.svelte";
  import { dismiss } from "../components/ui/dismiss";
  import Button from "../components/ui/Button.svelte";
  import Icon from "../components/Icon.svelte";

  /**
   * Permission review before a Chrome Web Store install or update (ADR-049). Main keeps the
   * verified package under `reviewId`; this dialog shows what the extension will be able to do and
   * answers. Closing it any other way (Escape, outside click, another popover) answers no.
   */
  let { reviewId, onClose }: { reviewId: string; onClose: (restoreFocus: boolean) => void } = $props();

  let review = $state<ExtensionReview | null>(null);
  let loaded = $state(false);
  let answered = false;
  let dialog = $state<HTMLElement>();
  let confirmButton = $state<HTMLButtonElement>();

  $effect(() => {
    void api.extensions
      .review(reviewId)
      .then((next) => (review = next), () => null)
      .finally(() => (loaded = true));
  });
  $effect(() => (confirmButton ?? dialog)?.focus());
  // Unmounted without an answer (dismissed, replaced): the install is cancelled.
  $effect(() => () => {
    if (!answered) api.extensions.answerReview(reviewId, false);
  });

  function answer(accepted: boolean): void {
    answered = true;
    api.extensions.answerReview(reviewId, accepted);
    onClose(!accepted);
  }

  const title = $derived(review ? (review.update ? `Mettre à jour « ${review.name} » ?` : `Ajouter « ${review.name} » ?`) : "Extension");
</script>

<div
  bind:this={dialog}
  use:dismiss={{ onDismiss: () => answer(false) }}
  class="dialog"
  role="dialog"
  aria-modal="true"
  aria-label={title}
  tabindex="-1"
>
  {#if review}
    <header>
      <span class="badge">
        {#if review.icon}<img src={review.icon} alt="" />{:else}<Icon name="extension" size={18} />{/if}
      </span>
      <div>
        <h2>{title}</h2>
        <p class="meta">Version {review.version} · {review.source === "file" ? "fichier déposé, sans signature vérifiée" : "Chrome Web Store, signature vérifiée"}</p>
      </div>
    </header>
    {#if review.permissions.length}
      <p>{review.update ? "La nouvelle version demande des autorisations supplémentaires. Elle pourra :" : "Elle pourra :"}</p>
      <ul>
        {#each review.permissions as permission (permission)}
          <li><Icon name="check" size={12} /> {permission}</li>
        {/each}
      </ul>
    {:else}
      <p>Cette extension ne demande aucune autorisation particulière.</p>
    {/if}
    <p class="hint">Elle ne s'exécutera pas dans les fenêtres privées. Vous pourrez la désactiver ou la retirer depuis la page Extensions.</p>
    <div class="actions">
      <Button variant="quiet" onclick={() => answer(false)}>Annuler</Button>
      <Button variant="primary" bind:element={confirmButton} onclick={() => answer(true)}>
        {review.update ? "Mettre à jour" : "Ajouter l'extension"}
      </Button>
    </div>
  {:else if loaded}
    <p>Cette demande d'installation a expiré.</p>
    <div class="actions"><Button onclick={() => onClose(true)}>Fermer</Button></div>
  {/if}
</div>

<style>
  .dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    width: min(calc(100vw - 2 * var(--space-4)), calc(var(--space-6) * 13));
    max-height: calc(100vh - 2 * var(--space-4));
    padding: var(--space-4);
    overflow: auto;
    border-radius: var(--radius-lg);
    background: var(--bg-elevated);
    box-shadow:
      0 0 0 1px var(--border),
      0 18px 50px -12px rgb(0 0 0 / 0.55);
    outline: none;
    transform: translate(-50%, -50%);
    animation: pop var(--motion-base) var(--ease);
  }
  header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .badge {
    display: grid;
    flex: none;
    place-items: center;
    width: var(--space-6);
    height: var(--space-6);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text-muted);
  }
  .badge img {
    width: var(--space-5);
    height: var(--space-5);
    object-fit: contain;
  }
  h2 {
    margin: 0;
    font-size: var(--text-md);
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  p {
    margin: 0;
    font-size: var(--text-sm);
    line-height: 1.45;
  }
  .meta,
  .hint {
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
  ul {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    font-size: var(--text-sm);
    list-style: none;
  }
  li {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: translate(-50%, -48%);
    }
  }
</style>
