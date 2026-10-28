<script lang="ts">
  import type { PasswordAccounts, PasswordPrompt, PromptAnswer } from "@shared/passwords";
  import type { Bounds, TabId } from "@shared/types";
  import { api } from "../lib/browser.svelte";
  import Icon from "../components/Icon.svelte";

  /**
   * Password popovers of the overlay layer (ADR-025). "save": the prompt after a login form was
   * submitted (main keeps the capture; this page only sees the site and username). "fill": the
   * accounts saved for the tab's site; picking one asks main to fill the page.
   */
  let {
    kind,
    anchor,
    captureId,
    tabId,
    onClose,
  }: { kind: "save" | "fill"; anchor?: Bounds; captureId?: string; tabId?: TabId; onClose: (restoreFocus: boolean) => void } = $props();

  const WIDTH = 320;
  const MARGIN = 8;

  let panel = $state<HTMLElement>();
  let innerWidth = $state(window.innerWidth);
  let innerHeight = $state(window.innerHeight);
  let prompt = $state<PasswordPrompt | null>(null);
  let accounts = $state<PasswordAccounts | null>(null);
  let loaded = $state(false);
  let error = $state<string | null>(null);
  let busy = $state(false);

  const position = $derived.by(() => {
    const box = anchor ?? { x: MARGIN, y: MARGIN, width: 0, height: 0 };
    const top = Math.max(MARGIN, box.y + box.height + 6);
    const left = Math.max(MARGIN, Math.min(box.x - 6, innerWidth - WIDTH - MARGIN));
    return { left, top, maxHeight: Math.max(160, innerHeight - top - MARGIN) };
  });

  $effect(() => {
    const done = () => (loaded = true);
    if (kind === "save" && captureId) void api.passwords.prompt(captureId).then((next) => (prompt = next), () => null).finally(done);
    else if (kind === "fill" && tabId) void api.passwords.accounts(tabId).then((next) => (accounts = next), () => null).finally(done);
    else done();
  });
  $effect(() => panel?.focus());

  async function answer(choice: PromptAnswer): Promise<void> {
    if (!captureId || busy) return;
    busy = true;
    const result = await api.passwords.answer(captureId, choice).catch(() => ({ ok: false as const, message: "Le mot de passe n'a pas été enregistré." }));
    busy = false;
    if (result.ok) onClose(false);
    else error = result.message;
  }

  async function fill(id: string): Promise<void> {
    if (!tabId || busy) return;
    busy = true;
    const filled = await api.passwords.fill(tabId, id).catch(() => false);
    busy = false;
    if (filled) onClose(false);
    else error = "Aucun champ de mot de passe à remplir sur cette page.";
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose(true);
    }
  }
</script>

<svelte:window bind:innerWidth bind:innerHeight onkeydown={onKeydown} />

<div
  bind:this={panel}
  class="panel"
  role="dialog"
  aria-label={kind === "save" ? "Enregistrer le mot de passe" : "Mots de passe enregistrés"}
  tabindex="-1"
  style:left="{position.left}px"
  style:top="{position.top}px"
  style:max-height="{position.maxHeight}px"
  style:width="{Math.min(WIDTH, innerWidth - 2 * MARGIN)}px"
>
  {#if kind === "save" && prompt}
    <header>
      <span class="badge"><Icon name="key" size={16} /></span>
      <h2>{prompt.update ? "Mettre à jour" : "Enregistrer"} le mot de passe pour {prompt.site} ?</h2>
    </header>
    <p class="account"><Icon name="circle-user" size={14} /> <span>{prompt.username || "Sans identifiant"}</span></p>
    <p class="hint">Chiffré et enregistré sur cet appareil uniquement.</p>
    {#if error}<p class="error" role="alert"><Icon name="warning" size={12} /> {error}</p>{/if}
    <div class="buttons">
      <button class="ghost" disabled={busy} onclick={() => answer("never")}>Jamais pour ce site</button>
      <button class="ghost" disabled={busy} onclick={() => answer("later")}>Plus tard</button>
      <button class="primary" disabled={busy} onclick={() => answer("save")}>{prompt.update ? "Mettre à jour" : "Enregistrer"}</button>
    </div>
  {:else if kind === "fill" && accounts}
    <header>
      <span class="badge"><Icon name="key" size={16} /></span>
      <h2>Mots de passe pour {accounts.site}</h2>
    </header>
    {#if accounts.accounts.length}
      <ul class="accounts" aria-label="Comptes enregistrés">
        {#each accounts.accounts as account (account.id)}
          <li>
            <button disabled={busy} onclick={() => fill(account.id)}>
              <Icon name="circle-user" size={14} />
              <span class="name">{account.username || "Sans identifiant"}</span>
              <span class="dots" aria-hidden="true">••••••••</span>
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="hint">Aucun mot de passe enregistré pour ce site.</p>
    {/if}
    {#if error}<p class="error" role="alert"><Icon name="warning" size={12} /> {error}</p>{/if}
    <div class="buttons">
      <button class="ghost" onclick={() => (api.commands.run("open-passwords"), onClose(false))}>Gérer les mots de passe</button>
    </div>
  {:else if loaded}
    <p class="hint">Cette demande n'est plus disponible.</p>
  {/if}
</div>

<style>
  .panel {
    position: fixed;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px;
    overflow: auto;
    border-radius: calc(var(--radius) + 4px);
    background: var(--bg-elevated);
    box-shadow:
      0 0 0 1px var(--border),
      0 18px 50px -12px rgb(0 0 0 / 0.55),
      0 4px 14px -6px rgb(0 0 0 / 0.35);
    outline: none;
    animation: pop 0.16s var(--ease);
    transform-origin: top left;
  }
  header {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .badge {
    display: grid;
    flex: none;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 10px;
    background: color-mix(in oklab, var(--accent) 14%, transparent);
    color: var(--accent-text);
  }
  h2 {
    margin: 0;
    font-size: 13.5px;
    font-weight: 600;
    line-height: 1.35;
    overflow-wrap: anywhere;
  }
  p {
    margin: 0;
  }
  .account {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: var(--radius);
    background: var(--surface);
    overflow-wrap: anywhere;
  }
  .hint {
    color: var(--text-muted);
    font-size: 12px;
  }
  .error {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--danger);
    font-size: 12px;
  }
  .buttons {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 6px;
  }
  .buttons button {
    height: 28px;
    padding: 0 10px;
    border-radius: 7px;
    font-size: 12.5px;
    font-weight: 500;
  }
  .ghost {
    color: var(--text-muted);
  }
  .ghost:hover:not(:disabled) {
    background: var(--surface-hover);
    color: var(--text);
  }
  .primary {
    background: var(--accent);
    color: #fff;
  }
  .primary:hover:not(:disabled) {
    background: color-mix(in oklab, var(--accent) 85%, #fff);
  }
  button:disabled {
    opacity: 0.5;
  }
  .accounts {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .accounts button {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 10px;
    border-radius: var(--radius);
    text-align: left;
  }
  .accounts button:hover:not(:disabled),
  .accounts button:focus-visible {
    background: var(--surface-hover);
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .dots {
    color: var(--text-faint);
    letter-spacing: 0.1em;
  }
</style>
