<script lang="ts">
  import { PROFILE_COLORS, PROFILE_ICONS, type ProfileIcon, type ProfileInfo, type ProfilesView } from "@shared/profiles";
  import { api, browser } from "../../lib/browser.svelte";
  import Icon from "../Icon.svelte";
  import Button from "../ui/Button.svelte";
  import Card from "../ui/Card.svelte";
  import ConfirmButton from "../ui/ConfirmButton.svelte";
  import EmptyState from "../ui/EmptyState.svelte";
  import Page from "../ui/Page.svelte";
  import Toggle from "../ui/Toggle.svelte";
  import BackupCard from "./BackupCard.svelte";

  /**
   * `browser://profiles` (ADR-042): the user profiles (each with its own settings, history,
   * bookmarks, passwords, session and sync), the picker shown at launch, and the open profile's
   * backup. Opening another profile opens a window of it.
   */

  let view = $state<ProfilesView | null>(null);
  /** The profile being created or edited (null: none). */
  let editing = $state<{ id: string | null; name: string; color: string; icon: ProfileIcon } | null>(null);

  async function load(): Promise<void> {
    view = await api.profiles.list().catch(() => view);
  }

  $effect(() => {
    void load();
  });

  function startCreate(): void {
    editing = { id: null, name: "", color: PROFILE_COLORS[(view?.profiles.length ?? 0) % PROFILE_COLORS.length], icon: "circle-user" };
  }

  function startEdit(profile: ProfileInfo): void {
    editing = { id: profile.id, name: profile.name, color: profile.color, icon: profile.icon };
  }

  async function save(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!editing || !editing.name.trim()) return;
    const input = { name: editing.name, color: editing.color, icon: editing.icon };
    if (editing.id) await api.profiles.update(editing.id, input).catch(() => false);
    else await api.profiles.create(input).catch(() => null);
    editing = null;
    await load();
  }

  async function remove(id: string): Promise<void> {
    await api.profiles.remove(id).catch(() => false);
    await load();
  }

  async function setAsk(ask: boolean): Promise<void> {
    await api.profiles.setAskOnLaunch(ask).catch(() => {});
    await load();
  }
</script>

<Page icon="users" title="Profils" subtitle="Chaque profil a ses propres réglages, historique, favoris, mots de passe et sessions." testid="profiles-page">
  {#snippet actions()}
    {#if !browser.isPrivate}
      <Button variant="primary" icon="plus" onclick={startCreate}>Nouveau profil</Button>
    {/if}
  {/snippet}

  {#if editing}
    <Card as="form" variant="section" class="profile-editor" aria-label={editing.id ? "Modifier le profil" : "Nouveau profil"} onsubmit={save}>
      <label class="field">
        <span>Nom</span>
        <!-- svelte-ignore a11y_autofocus -->
        <input class="ui-field" maxlength="40" bind:value={editing.name} placeholder="Travail, Études…" autofocus />
      </label>
      <div class="field">
        <span>Couleur</span>
        <div class="swatches" role="radiogroup" aria-label="Couleur">
          {#each PROFILE_COLORS as color (color)}
            <button
              type="button"
              class="swatch"
              role="radio"
              aria-checked={editing.color === color}
              aria-label={color}
              style:background={color}
              onclick={() => editing && (editing.color = color)}
            ></button>
          {/each}
        </div>
      </div>
      <div class="field">
        <span>Icône</span>
        <div class="icons" role="radiogroup" aria-label="Icône">
          {#each PROFILE_ICONS as icon (icon)}
            <button type="button" class="icon" role="radio" aria-checked={editing.icon === icon} aria-label={icon} onclick={() => editing && (editing.icon = icon)}>
              <Icon name={icon} size={16} />
            </button>
          {/each}
        </div>
      </div>
      <div class="buttons">
        <Button variant="quiet" onclick={() => (editing = null)}>Annuler</Button>
        <Button type="submit" variant="primary" disabled={!editing.name.trim()}>{editing.id ? "Enregistrer" : "Créer le profil"}</Button>
      </div>
    </Card>
  {/if}

  {#if view}
    <Card>
      {#each view.profiles as profile (profile.id)}
        <li class="profile" data-profile={profile.id}>
          <span class="avatar" style:background={profile.color}><Icon name={profile.icon} size={16} /></span>
          <span class="name">
            {profile.name}
            {#if profile.id === view.current}<span class="current">Profil actuel</span>{/if}
          </span>
          {#if profile.id !== view.current}
            <Button size="sm" icon="open" onclick={() => api.profiles.open(profile.id)}>Ouvrir</Button>
          {/if}
          {#if !browser.isPrivate}
            <Button size="sm" variant="quiet" icon="pencil" onclick={() => startEdit(profile)}>Modifier</Button>
            {#if profile.id !== view.current && profile.id !== "default"}
              <ConfirmButton question="Supprimer ce profil et toutes ses données ?" confirmLabel="Supprimer" onconfirm={() => remove(profile.id)}>
                <Icon name="trash" size={14} /> Supprimer
              </ConfirmButton>
            {/if}
          {/if}
        </li>
      {/each}
    </Card>
    {#if !browser.isPrivate}
      <Card as="div" variant="section">
        <div class="row">
          <span class="label">
            Choisir le profil au démarrage
            <span class="hint">Sinon, le dernier profil utilisé s'ouvre.</span>
          </span>
          <Toggle label="Choisir le profil au démarrage" checked={view.askOnLaunch} onchange={setAsk} />
        </div>
      </Card>
    {/if}
  {:else}
    <EmptyState icon="users" title="Chargement des profils…" />
  {/if}

  {#if !browser.isPrivate}
    <BackupCard />
  {/if}
</Page>

<style>
  :global(.profile-editor) {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
  .swatches,
  .icons {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .swatch {
    width: var(--hit-min);
    height: var(--hit-min);
    border-radius: var(--radius-pill);
  }
  .swatch[aria-checked="true"] {
    box-shadow: 0 0 0 2px var(--bg-elevated), 0 0 0 4px var(--text);
  }
  .icon {
    display: grid;
    place-items: center;
    width: var(--hit-min);
    height: var(--hit-min);
    border-radius: var(--radius-sm);
    color: var(--text);
  }
  .icon[aria-checked="true"] {
    background: var(--surface-active);
    color: var(--accent-text);
  }
  .buttons {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
  .profile {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
  }
  .avatar {
    display: grid;
    place-items: center;
    flex: none;
    width: 30px;
    height: 30px;
    border-radius: var(--radius-pill);
    color: #fff;
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .current {
    margin-left: var(--space-2);
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-top: var(--space-4);
  }
  .label {
    display: flex;
    flex: 1;
    flex-direction: column;
  }
  .hint {
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
</style>
