<script lang="ts">
  import { untrack } from "svelte";
  import { PROFILE_COLORS, PROFILE_ICONS, type ProfileIcon, type ProfileInfo, type ProfilesView } from "@shared/profiles";
  import { internalFragment } from "@shared/internal";
  import { api, browser } from "../../lib/browser.svelte";
  import Icon from "../Icon.svelte";
  import Button from "../ui/Button.svelte";
  import Card from "../ui/Card.svelte";
  import ConfirmButton from "../ui/ConfirmButton.svelte";
  import EmptyState from "../ui/EmptyState.svelte";
  import ListRow from "../ui/ListRow.svelte";
  import Page from "../ui/Page.svelte";
  import Row from "../ui/Row.svelte";
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

  /** `browser://profiles#new` (command « Nouveau profil… »): the editor opens on arrival. */
  const fragment = $derived(internalFragment(browser.activeTab?.url ?? ""));
  $effect(() => {
    if (fragment === "new" && !browser.isPrivate) untrack(startCreate);
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
    <Card as="form" variant="section" aria-label={editing.id ? "Modifier le profil" : "Nouveau profil"} onsubmit={save}>
      <div class="editor">
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
      </div>
    </Card>
  {/if}

  {#if view?.profiles.length}
    <section class="ui-section">
      <Card as="ul" aria-label="Profils">
        {#each view.profiles as profile (profile.id)}
          {@const current = profile.id === view.current}
          <ListRow data-profile={profile.id}>
            <span class="avatar" style:background={profile.color}><Icon name={profile.icon} size={16} /></span>
            <span class="name">{profile.name}</span>
            {#if current}<span class="badge">Profil actuel</span>{/if}
            <span class="actions">
              {#if !current}
                <Button size="sm" icon="open" onclick={() => api.profiles.open(profile.id)}>Ouvrir</Button>
              {/if}
              {#if !browser.isPrivate}
                <Button size="sm" variant="quiet" icon="pencil" onclick={() => startEdit(profile)}>Modifier</Button>
                {#if !current && profile.id !== "default"}
                  <ConfirmButton question="Supprimer ce profil et toutes ses données ?" confirmLabel="Supprimer" title={`Supprimer ${profile.name}`} onconfirm={() => remove(profile.id)}>
                    <Icon name="trash" size={14} /> Supprimer
                  </ConfirmButton>
                {/if}
              {/if}
            </span>
          </ListRow>
        {/each}
      </Card>
      {#if view.profiles.length === 1}
        <p class="ui-section-hint">
          Un seul profil pour l'instant. Créez-en un autre pour séparer, par exemple, le travail et la vie personnelle : chacun garde ses propres données.
        </p>
      {/if}
    </section>

    {#if !browser.isPrivate}
      <section class="ui-section" aria-labelledby="launch-title">
        <h2 class="ui-section-title" id="launch-title">Démarrage</h2>
        <Card as="div" variant="section">
          <Row label="Choisir le profil au démarrage" hint="Sinon, le dernier profil utilisé s'ouvre." anchor="ask-on-launch">
            <Toggle label="Choisir le profil au démarrage" checked={view.askOnLaunch} onchange={setAsk} />
          </Row>
        </Card>
      </section>
    {/if}
  {:else if view}
    <EmptyState icon="users" title="Aucun profil" hint="Créez un profil pour séparer vos réglages, votre historique et vos mots de passe." />
  {:else}
    <EmptyState icon="users" title="Chargement des profils…" />
  {/if}

  {#if !browser.isPrivate}
    <BackupCard />
  {/if}
</Page>

<style>
  /* Same inner margin as a settings row (`Row`). */
  .editor {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
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
    box-shadow:
      0 0 0 2px var(--bg-elevated),
      0 0 0 4px var(--text);
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
  .avatar {
    display: grid;
    place-items: center;
    flex: none;
    width: var(--field-height);
    height: var(--field-height);
    border-radius: var(--radius-pill);
    color: #fff;
  }
  .name {
    min-width: 0;
    overflow: hidden;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .badge {
    flex: none;
    padding: 0 var(--space-2);
    border-radius: var(--radius-pill);
    background: color-mix(in oklab, var(--accent) 16%, transparent);
    color: var(--accent-text);
    font-size: var(--text-xs);
    font-weight: 600;
    line-height: 1.7;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-1);
    margin-left: auto;
  }
</style>
