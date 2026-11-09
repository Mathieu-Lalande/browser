<script lang="ts">
  import { t } from "@shared/i18n";
  import { SCOPES } from "@shared/omnibox/scopes";
  import type { ScopeId } from "@shared/omnibox/types";
  import Icon from "../../components/Icon.svelte";
  import { iconOf } from "./icons";

  /** Scope shortcuts shown before typing: they teach the `@` prefixes and work with the mouse. */
  let { onPick }: { onPick: (scope: ScopeId) => void } = $props();
</script>

<div class="chips" role="toolbar" aria-label={t("scopeChips.filters")}>
  {#each SCOPES as scope (scope.id)}
    <button
      class="chip"
      title={t("scopeChips.type", { label: scope.label, p: scope.names[0], p2: scope.names[1] })}
      onmousedown={(event) => event.preventDefault()}
      onclick={() => onPick(scope.id)}
    >
      <Icon name={iconOf(scope.icon)} size={12} />
      {scope.label}
      <kbd>@{scope.names[1]}</kbd>
    </button>
  {/each}
</div>

<style>
  .chips {
    display: flex;
    flex: none;
    flex-wrap: wrap;
    gap: 6px;
    padding: 10px 14px 4px;
  }
  .chip {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 6px 0 9px;
    border-radius: 999px;
    background: var(--surface);
    box-shadow: inset 0 0 0 1px var(--border);
    color: var(--text-muted);
    font-size: 12px;
  }
  .chip:hover {
    background: var(--surface-hover);
    color: var(--text);
  }
  kbd {
    padding: 1px 5px;
    border-radius: 5px;
    background: var(--surface-active);
    color: var(--text-faint);
    font: 500 10.5px/1.4 var(--font);
  }
</style>
