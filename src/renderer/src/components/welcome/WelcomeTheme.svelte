<script lang="ts">
  import { t } from "@shared/i18n";
  import type { ResolvedMode } from "@shared/theme";
  import { THEME_GALLERY, applyTheme, isCurrentTheme, themePatch, type SharedTheme } from "@shared/theme-share";
  import { settings } from "../../lib/settings.svelte";
  import Icon from "../Icon.svelte";
  import MiniBrowser from "../settings/MiniBrowser.svelte";

  /** Welcome, step 2 (ADR-043): the theme gallery of the settings (ADR-030), applied on click. */

  const s = $derived(settings.current);
  const modeOf = (theme: SharedTheme): ResolvedMode => (theme.mode === "system" ? (settings.systemDark ? "dark" : "light") : theme.mode);
</script>

<div class="gallery" role="group" aria-label={t("welcomeTheme.themes")}>
  {#each THEME_GALLERY as theme (theme.name)}
    <button class="card" aria-pressed={isCurrentTheme(s, theme)} onclick={() => settings.update(themePatch(theme, settings.current))}>
      <span class="frame"><MiniBrowser settings={applyTheme(s, theme)} mode={modeOf(theme)} /></span>
      <span class="caption">
        {#if isCurrentTheme(s, theme)}<Icon name="check" size={12} />{/if}
        {theme.name}
      </span>
    </button>
  {/each}
</div>

<style>
  .gallery {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: var(--space-3);
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: 6px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    text-align: left;
    transition:
      border-color var(--motion-fast) var(--ease),
      transform var(--motion-fast) var(--ease);
  }
  .card:hover {
    border-color: color-mix(in oklab, var(--accent) 40%, var(--border));
  }
  .card:active {
    transform: scale(0.98);
  }
  .card[aria-pressed="true"] {
    border-color: var(--accent-text);
    box-shadow: 0 0 0 1px var(--accent-text);
  }
  .frame {
    display: block;
    aspect-ratio: 16 / 9;
    overflow: hidden;
    border-radius: var(--radius-sm);
  }
  .caption {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 2px 2px;
    font-size: var(--text-xs);
    font-weight: 500;
  }
  .card[aria-pressed="true"] .caption {
    color: var(--accent-text);
  }
</style>
