<script lang="ts">
  import { settings } from "../../lib/settings.svelte";
  import Row from "../ui/Row.svelte";
  import Toggle from "../ui/Toggle.svelte";

  /** "Notifications" (ADR-041): do not disturb, and where the per-site choices live. */
  const n = $derived(settings.current.notifications);
</script>

<Row anchor="do-not-disturb" label="Ne pas déranger" hint="Les notifications des sites ne s'affichent plus, sans rien leur signaler." keywords="silence muet notifications alertes">
  <Toggle label="Ne pas déranger" checked={n.doNotDisturb} onchange={(doNotDisturb) => settings.update({ notifications: { doNotDisturb } })} />
</Row>
<Row
  anchor="per-site"
  label="Autorisations par site"
  hint="Un site demande d'abord la permission (barre au-dessus de la page). Pour changer d'avis : Infos sur le site, depuis le cadenas de la barre d'adresse."
  keywords="permission autoriser bloquer site"
>
  <span class="note">Dans Infos sur le site</span>
</Row>
<Row
  anchor="push"
  label="Notifications en arrière-plan"
  hint="Les notifications « push » envoyées quand le site est fermé (service workers) ne sont pas prises en charge : seuls les onglets ouverts peuvent en afficher."
  keywords="web push service worker arrière-plan"
>
  <span class="note">Non prises en charge</span>
</Row>

<style>
  .note {
    color: var(--text-faint);
    font-size: var(--text-xs);
  }
</style>
