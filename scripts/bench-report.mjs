// Pure helpers of the benchmark (`scripts/bench.mjs`, ADR-043): statistics and the Markdown
// report. No Node or Electron API here, so that Vitest can test them (`bench-report.test.ts`).

/** Median of a list of numbers (null when empty). */
export function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** `{ median, min, max, runs }` of the measures, rounded to `digits`. */
export function summarize(values, digits = 0) {
  const finite = values.filter((value) => Number.isFinite(value));
  const round = (value) => (value === null ? null : Number(value.toFixed(digits)));
  return {
    median: round(median(finite)),
    min: round(finite.length ? Math.min(...finite) : null),
    max: round(finite.length ? Math.max(...finite) : null),
    runs: finite.length,
  };
}

const KB_PER_MB = 1024;

/** `app.getAppMetrics()` → total working set in MB, and the process count. */
export function sumMetrics(metrics) {
  const kb = metrics.reduce((sum, metric) => sum + (metric?.memory?.workingSetSize ?? 0), 0);
  return { memoryMb: Number((kb / KB_PER_MB).toFixed(1)), processes: metrics.length };
}

/** Rows of the report: [key, label, unit]. */
export const ROWS = [
  ["coldStartFirstPaintMs", "Démarrage à froid → premier rendu de l'interface", "ms"],
  ["coldStartReadyMs", "Démarrage à froid → barre latérale prête", "ms"],
  ["newTabMs", "Nouvel onglet → page d'accueil interactive", "ms"],
  ["memory1TabMb", "Mémoire, 1 onglet", "Mo"],
  ["memory10TabsMb", "Mémoire, 10 onglets", "Mo"],
  ["memory30TabsMb", "Mémoire, 30 onglets", "Mo"],
  ["memoryAfterSleepMb", "Mémoire, 30 onglets dont 29 en veille", "Mo"],
];

const format = (value, unit) => (value === null || value === undefined ? "–" : `${value.toLocaleString("fr-FR")} ${unit}`);

/** The Markdown table published in `docs/perf/` and on the site. */
export function toMarkdown(result) {
  const env = result.environment;
  const lines = [
    `# Mesures de performance`,
    "",
    `Mesuré le ${result.date.slice(0, 10)} sur ${env.label} (${env.os}, ${env.cpu}, ${env.cores} cœurs, ${env.memoryGb} Go), ` +
      `build ${env.build}, Browser ${env.appVersion}, Electron ${env.electron}, commit ${env.commit}.`,
    "",
    "| Mesure | Médiane | Min | Max |",
    "| --- | ---: | ---: | ---: |",
  ];
  for (const [key, label, unit] of ROWS) {
    const metric = result.metrics[key];
    if (!metric) continue;
    lines.push(`| ${label} | ${format(metric.median, unit)} | ${format(metric.min, unit)} | ${format(metric.max, unit)} |`);
  }
  lines.push(
    "",
    `${result.runs} démarrages à froid, ${result.newTabRuns} nouveaux onglets ; pages locales servies par le script (aucun réseau).`,
    "Mémoire : somme du « working set » de tous les processus (`app.getAppMetrics()`) ; sous Linux, chaque processus y compte",
    "aussi les pages partagées (bibliothèques, mémoire GPU partagée) : la somme surestime l'empreinte réelle, mais reste",
    "comparable d'une version à l'autre.",
    "Ces chiffres ne se comparent qu'avec d'autres navigateurs mesurés sur la même machine : voir `scripts/bench-compare.md`.",
    "",
  );
  return lines.join("\n");
}
