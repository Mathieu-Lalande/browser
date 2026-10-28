<script lang="ts">
  import { originLabel, searchPasswords, type PasswordSummary, type PasswordsStatus } from "@shared/passwords";
  import { api } from "../../lib/browser.svelte";
  import Icon from "../Icon.svelte";
  import ConfirmButton from "../settings/ConfirmButton.svelte";

  /**
   * `browser://passwords` (ADR-025): saved passwords, searched by site or username. The list has
   * no password: "Afficher" asks for a confirmation, then main sends that one password; copying
   * and exporting happen in main (clipboard, save dialog).
   */

  let entries = $state<PasswordSummary[]>([]);
  let never = $state<string[]>([]);
  let status = $state<PasswordsStatus | null>(null);
  let loaded = $state(false);
  let query = $state("");
  /** Passwords shown after confirmation, by entry id (forgotten on the next refresh). */
  let revealed = $state<Record<string, string>>({});
  let editing = $state<{ id: string; username: string; password: string } | null>(null);
  let notice = $state<{ kind: "error" | "success"; text: string } | null>(null);
  let copiedId = $state<string | null>(null);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  let request = 0;

  const shown = $derived(searchPasswords(entries, query));
  const dateFormat = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" });

  async function refresh(): Promise<void> {
    const id = ++request;
    const [list, neverList, current] = await Promise.all([
      api.passwords.list().catch(() => []),
      api.passwords.neverList().catch(() => []),
      api.passwords.status().catch(() => null),
    ]);
    if (id !== request) return;
    entries = list;
    never = neverList;
    status = current;
    revealed = {};
    loaded = true;
  }

  $effect(() => {
    void refresh();
    return api.passwords.onChanged(() => void refresh());
  });

  async function reveal(id: string): Promise<void> {
    const password = await api.passwords.reveal(id).catch(() => null);
    if (password !== null) revealed = { ...revealed, [id]: password };
  }

  function hide(id: string): void {
    const { [id]: _hidden, ...rest } = revealed;
    revealed = rest;
  }

  async function copy(id: string): Promise<void> {
    if (!(await api.passwords.copy(id).catch(() => false))) return;
    copiedId = id;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copiedId = null), 1600);
  }

  async function saveEdit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!editing) return;
    const { id, username, password } = editing;
    const result = await api.passwords.update(id, password ? { username, password } : { username }).catch(() => ({ ok: false as const, message: "La modification a échoué." }));
    if (result.ok) {
      editing = null;
      notice = null;
    } else notice = { kind: "error", text: result.message };
  }

  async function exportCsv(): Promise<void> {
    const result = await api.passwords.exportCsv().catch(() => ({ ok: false as const, message: "L'exportation a échoué." }));
    if (!result) return;
    notice = result.ok ? { kind: "success", text: "Mots de passe exportés." } : { kind: "error", text: result.message };
  }
</script>

<div class="page" data-testid="passwords-page">
  <div class="inner">
    <header>
      <span class="badge"><Icon name="key" size={20} /></span>
      <h1>Mots de passe</h1>
      {#if entries.length}
        <ConfirmButton
          variant="outlined"
          question="Exporter en clair dans un fichier CSV ?"
          confirmLabel="Exporter"
          title="Exporter les mots de passe (fichier CSV non chiffré)"
          onconfirm={exportCsv}
        >
          <Icon name="file-down" size={12} /> Exporter
        </ConfirmButton>
      {/if}
    </header>

    <p class="intro">
      Proposés après une connexion, chiffrés avec le trousseau du système et stockés sur cet appareil uniquement. Un mot de passe n'est
      rempli que sur le site exact où il a été enregistré, et seulement quand vous le demandez (clé de la barre d'adresse ou clic droit
      dans un champ).
    </p>

    {#if status && !status.available}
      <p class="notice error" role="alert"><Icon name="warning" size={14} /> <span>{status.message}</span></p>
    {:else if status?.weak}
      <p class="notice"><Icon name="warning" size={14} /> <span>Aucun trousseau système détecté : les mots de passe sont enregistrés avec une protection faible.</span></p>
    {/if}
    {#if notice}
      <p class="notice {notice.kind}" role={notice.kind === "error" ? "alert" : "status"}>
        <Icon name={notice.kind === "error" ? "warning" : "check"} size={14} />
        <span>{notice.text}</span>
        <button class="icon-button" aria-label="Fermer le message" onclick={() => (notice = null)}><Icon name="close" size={12} /></button>
      </p>
    {/if}

    {#if entries.length}
      <label class="search">
        <Icon name="search" size={14} />
        <input bind:value={query} placeholder="Rechercher un site ou un identifiant" aria-label="Rechercher dans les mots de passe" spellcheck="false" />
      </label>
      <ul class="card" aria-label="Mots de passe enregistrés">
        {#each shown as entry (entry.id)}
          <li class="row" data-password-id={entry.id}>
            {#if editing?.id === entry.id}
              <form class="edit" onsubmit={saveEdit}>
                <span class="site">{originLabel(entry.origin)}</span>
                <input bind:value={editing.username} aria-label="Identifiant" placeholder="Identifiant" spellcheck="false" />
                <input bind:value={editing.password} type="password" aria-label="Nouveau mot de passe" placeholder="Nouveau mot de passe (inchangé si vide)" autocomplete="new-password" />
                <span class="edit-actions">
                  <button type="button" class="text-button" onclick={() => (editing = null)}>Annuler</button>
                  <button type="submit" class="text-button strong">Enregistrer</button>
                </span>
              </form>
            {:else}
              <span class="text">
                <span class="site">{originLabel(entry.origin)}</span>
                <span class="user">{entry.username || "Sans identifiant"}</span>
                <span class="secret" class:mono={entry.id in revealed} data-testid="password-value">{revealed[entry.id] ?? "••••••••••"}</span>
                <span class="detail">
                  Modifié le {dateFormat.format(entry.updatedAt)}{entry.lastUsedAt ? ` · utilisé le ${dateFormat.format(entry.lastUsedAt)}` : ""}
                </span>
              </span>
              <span class="actions">
                {#if entry.id in revealed}
                  <button class="icon-button" title="Masquer" aria-label={`Masquer le mot de passe de ${originLabel(entry.origin)}`} onclick={() => hide(entry.id)}>
                    <Icon name="eye-off" size={14} />
                  </button>
                {:else}
                  <ConfirmButton question="Afficher le mot de passe ?" confirmLabel="Afficher" title={`Afficher le mot de passe de ${originLabel(entry.origin)}`} onconfirm={() => reveal(entry.id)}>
                    <Icon name="eye" size={14} />
                  </ConfirmButton>
                {/if}
                <button class="icon-button" title={copiedId === entry.id ? "Copié" : "Copier le mot de passe"} aria-label={`Copier le mot de passe de ${originLabel(entry.origin)}`} onclick={() => copy(entry.id)}>
                  <Icon name={copiedId === entry.id ? "check" : "copy-text"} size={14} />
                </button>
                <button
                  class="icon-button"
                  title="Modifier"
                  aria-label={`Modifier le mot de passe de ${originLabel(entry.origin)}`}
                  onclick={() => (editing = { id: entry.id, username: entry.username, password: "" })}
                >
                  <Icon name="pencil" size={14} />
                </button>
                <ConfirmButton question="Supprimer ce mot de passe ?" confirmLabel="Supprimer" title={`Supprimer le mot de passe de ${originLabel(entry.origin)}`} onconfirm={() => api.passwords.remove(entry.id)}>
                  <Icon name="trash" size={14} />
                </ConfirmButton>
              </span>
            {/if}
          </li>
        {:else}
          <li class="row empty-row">Aucun résultat pour « {query} ».</li>
        {/each}
      </ul>
    {:else if loaded}
      <div class="empty">
        <Icon name="key" size={28} />
        <p>Aucun mot de passe enregistré.</p>
        <p class="detail">Connectez-vous à un site : le navigateur proposera d'enregistrer le mot de passe.</p>
      </div>
    {/if}

    {#if never.length}
      <h2><Icon name="ban" size={14} /> Jamais enregistrés</h2>
      <ul class="card" aria-label="Sites jamais enregistrés">
        {#each never as origin (origin)}
          <li class="row">
            <span class="text"><span class="site">{originLabel(origin)}</span></span>
            <button class="text-button" aria-label={`Retirer ${originLabel(origin)} de la liste`} onclick={() => api.passwords.removeNever(origin)}>Retirer</button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

<style>
  .page {
    height: 100%;
    overflow-y: auto;
    animation: rise 0.3s var(--ease);
  }
  .inner {
    display: flex;
    flex-direction: column;
    gap: 16px;
    max-width: 760px;
    margin: 0 auto;
    padding: 36px 32px 64px;
  }
  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 12px;
  }
  .badge {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 11px;
    background: color-mix(in oklab, var(--accent) 16%, transparent);
    color: var(--accent-text);
  }
  h1 {
    flex: 1 1 auto;
    min-width: 0;
    margin: 0;
    white-space: nowrap;
    font-size: 22px;
    font-weight: 650;
    letter-spacing: -0.03em;
  }
  h2 {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 8px 0 0;
    font-size: 14px;
    font-weight: 600;
  }
  .intro {
    margin: 0;
    color: var(--text-muted);
    line-height: 1.5;
  }
  .notice {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    padding: 8px 10px 8px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    line-height: 1.4;
  }
  .notice span {
    flex: 1;
  }
  .notice.error {
    border-color: color-mix(in oklab, var(--danger) 45%, transparent);
    color: var(--danger);
  }
  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text-muted);
  }
  .search input,
  .edit input {
    flex: 1;
    min-width: 0;
    border: none;
    background: transparent;
    color: var(--text);
    outline: none;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin: 0;
    padding: 4px;
    list-style: none;
    border: 1px solid var(--border);
    border-radius: calc(var(--radius) + 2px);
    background: var(--bg-elevated);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px;
    border-radius: var(--radius);
  }
  .row:hover {
    background: var(--surface-hover);
  }
  .empty-row {
    color: var(--text-muted);
  }
  .text {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .site {
    font-weight: 600;
  }
  .secret {
    color: var(--text-muted);
    letter-spacing: 0.08em;
  }
  .secret.mono {
    color: var(--text);
    font-family: var(--font-mono, monospace);
    letter-spacing: 0;
  }
  .detail {
    color: var(--text-muted);
    font-size: 12px;
  }
  .actions {
    display: flex;
    flex: none;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 2px;
  }
  .icon-button {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 7px;
    color: var(--text-muted);
  }
  .icon-button:hover {
    background: var(--surface-hover);
    color: var(--text);
  }
  .text-button {
    height: 28px;
    padding: 0 10px;
    border-radius: 7px;
    color: var(--text-muted);
  }
  .text-button:hover {
    background: var(--surface-hover);
    color: var(--text);
  }
  .text-button.strong {
    color: var(--accent-text);
    font-weight: 600;
  }
  .edit {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 8px;
  }
  .edit input {
    height: 30px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: var(--surface);
  }
  .edit-actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 48px 0 8px;
    color: var(--text-muted);
    text-align: center;
  }
  .empty p {
    margin: 0;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
  }
</style>
