<script lang="ts">
  import { widevineLabel, type WidevineStatus } from "@shared/drm";
  import { api } from "../../lib/browser.svelte";
  import { settings } from "../../lib/settings.svelte";
  import Row from "../ui/Row.svelte";
  import Toggle from "../ui/Toggle.svelte";

  /** Settings > Confidentialité: "Contenus protégés (DRM)", Widevine status and switch (ADR-040). */

  let status = $state<WidevineStatus | null>(null);
  const enabled = $derived(settings.current.privacy.protectedContent);

  // Re-read when the setting changes, and every few seconds while the CDM is being installed.
  $effect(() => {
    void enabled;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let live = true;
    const refresh = () =>
      api.drm.status().then(
        (current) => {
          if (!live) return;
          status = current;
          if (current.state === "installing") timer = setTimeout(refresh, 3000);
        },
        () => {},
      );
    void refresh();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  });

  const hint = $derived(
    status?.state === "disabled"
      ? "Netflix, Disney+, Prime Video et Spotify ne pourront pas lire leurs contenus."
      : "Lecture des vidéos et musiques protégées (Netflix, Disney+, Prime Video, Spotify) grâce au module Widevine de Google.",
  );
</script>

<Row anchor="drm" label="Contenus protégés (DRM)" {hint} keywords="widevine netflix disney prime video spotify streaming drm">
  <span class="status" data-testid="drm-status">{widevineLabel(status)}</span>
  <Toggle
    label="Contenus protégés (DRM)"
    checked={enabled}
    onchange={(protectedContent) => settings.update({ privacy: { protectedContent } })}
  />
</Row>

<style>
  .status {
    color: var(--text-muted);
    font-size: var(--text-sm);
    margin-right: var(--space-2);
  }
</style>
