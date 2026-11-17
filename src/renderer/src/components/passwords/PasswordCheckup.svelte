<script lang="ts">
  import { formatDate, t } from "@shared/i18n";
  import { checkupCounts, checkupScore, type CheckupReport } from "@shared/password-checkup";
  import { api } from "../../lib/browser.svelte";
  import Icon from "../Icon.svelte";
  import Button from "../ui/Button.svelte";
  import Checkbox from "../ui/Checkbox.svelte";

  /**
   * "Bilan de sécurité" of `browser://passwords` (ADR-059): a score ring and three counters, the
   * check runs on demand. Breaches are opt-in per check, with what leaves the device said plainly.
   */
  let { report = $bindable(null) }: { report: CheckupReport | null } = $props();

  let breaches = $state(true);
  let busy = $state(false);

  const counts = $derived(report ? checkupCounts(report) : null);
  const score = $derived(report ? checkupScore(report) : null);
  const tone = $derived(score === null ? "idle" : score >= 90 ? "good" : score >= 60 ? "fair" : "bad");
  /** Ring geometry: r = 26 → circumference ≈ 163.4. */
  const CIRC = 2 * Math.PI * 26;

  async function run(): Promise<void> {
    busy = true;
    try {
      report = await api.passwords.checkup(breaches);
    } finally {
      busy = false;
    }
  }
</script>

<section class="checkup {tone}" aria-label={t("passwordCheckup.title")} data-testid="password-checkup">
  <div class="ring" aria-hidden="true">
    <svg viewBox="0 0 64 64" width="64" height="64">
      <circle class="track" cx="32" cy="32" r="26" />
      <circle class="value" cx="32" cy="32" r="26" stroke-dasharray={CIRC} stroke-dashoffset={CIRC * (1 - (score ?? 0) / 100)} />
    </svg>
    <span class="score">{#if score === null}<Icon name="shield" size={20} />{:else}{score}{/if}</span>
  </div>

  <div class="body">
    <h2>{t("passwordCheckup.title")}</h2>
    {#if report && counts}
      <p class="summary" role="status">
        {#if report.issues.length === 0}
          {t("passwordCheckup.allGood", { total: report.total })}
        {:else}
          {t("passwordCheckup.toFix", { count: report.issues.length })}
        {/if}
        <span class="when">· {formatDate(report.checkedAt, { timeStyle: "short" })}</span>
      </p>
      <ul class="stats">
        <li class="stat breached" class:zero={!counts.breached}>
          <Icon name="shield-alert" size={14} />
          <strong>{report.breachCheck === "ok" ? counts.breached : "–"}</strong>
          {t("passwordCheckup.breached")}
        </li>
        <li class="stat reused" class:zero={!counts.reused}><Icon name="repeat" size={14} /> <strong>{counts.reused}</strong> {t("passwordCheckup.reused")}</li>
        <li class="stat weak" class:zero={!counts.weak}><Icon name="warning" size={14} /> <strong>{counts.weak}</strong> {t("passwordCheckup.weak")}</li>
      </ul>
      {#if report.breachCheck === "failed"}<p class="hint error">{t("passwordCheckup.breachFailed")}</p>{/if}
    {:else}
      <p class="summary">{t("passwordCheckup.intro")}</p>
    {/if}
    <div class="controls">
      <Checkbox checked={breaches} onchange={(next) => (breaches = next)}>{t("passwordCheckup.includeBreaches")}</Checkbox>
      <Button variant="primary" icon={busy ? "loader" : "shield-check"} disabled={busy} onclick={run}>
        {report ? t("passwordCheckup.checkAgain") : t("passwordCheckup.check")}
      </Button>
    </div>
    <p class="hint">{t("passwordCheckup.privacy")}</p>
  </div>
</section>

<style>
  .checkup {
    --tone: var(--accent);
    display: flex;
    gap: var(--space-4);
    padding: var(--space-4);
    border: 1px solid color-mix(in oklab, var(--tone) 30%, var(--border));
    border-radius: var(--radius-lg);
    background:
      radial-gradient(120% 140% at 0% 0%, color-mix(in oklab, var(--tone) 16%, transparent), transparent 60%),
      var(--bg-elevated);
  }
  .checkup.good {
    --tone: var(--success);
  }
  .checkup.fair {
    --tone: color-mix(in oklab, var(--danger) 45%, var(--accent-2));
  }
  .checkup.bad {
    --tone: var(--danger);
  }
  .ring {
    position: relative;
    display: grid;
    flex: none;
    place-items: center;
    width: 64px;
    height: 64px;
  }
  .ring svg {
    transform: rotate(-90deg);
  }
  .track,
  .value {
    fill: none;
    stroke-width: 6;
  }
  .track {
    stroke: color-mix(in oklab, var(--tone) 18%, transparent);
  }
  .value {
    stroke: var(--tone);
    stroke-linecap: round;
    transition: stroke-dashoffset var(--motion-base) var(--ease);
  }
  .score {
    position: absolute;
    color: var(--tone);
    font-size: var(--text-lg);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .body {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }
  h2 {
    margin: 0;
    font-size: var(--text-md);
    font-weight: 600;
  }
  .summary {
    margin: 0;
    color: var(--text-muted);
  }
  .when {
    color: var(--text-faint);
  }
  .stats {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .stat {
    --c: var(--danger);
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-pill);
    background: color-mix(in oklab, var(--c) 14%, transparent);
    color: color-mix(in oklab, var(--c) 75%, var(--text));
    font-size: var(--text-xs);
  }
  .stat.reused {
    --c: color-mix(in oklab, var(--danger) 45%, var(--accent-2));
  }
  .stat.weak {
    --c: var(--accent);
  }
  .stat.zero {
    --c: var(--text-faint);
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2) var(--space-4);
    margin-top: var(--space-1);
  }
  .hint {
    margin: 0;
    color: var(--text-faint);
    font-size: var(--text-xs);
    line-height: 1.45;
  }
  .hint.error {
    color: var(--danger-text);
  }
</style>
