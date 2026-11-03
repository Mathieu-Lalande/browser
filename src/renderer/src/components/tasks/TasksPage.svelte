<script lang="ts">
  import { TASKS_REFRESH_MS, formatMemory, sortTaskRows, type TaskRow, type TaskSortKey } from "@shared/tasks";
  import { api } from "../../lib/browser.svelte";
  import Icon from "../Icon.svelte";
  import Button from "../ui/Button.svelte";
  import Card from "../ui/Card.svelte";
  import Page from "../ui/Page.svelte";

  /**
   * `browser://tasks` (ADR-042): the app's processes, CPU and memory, refreshed every 2 s while the
   * page is shown (nothing is measured otherwise). Only a tab renderer can be ended: its tabs then
   * show "Cette page a planté".
   */

  let rows = $state<TaskRow[]>([]);
  let sortKey = $state<TaskSortKey>("memory");
  let descending = $state(true);

  const sorted = $derived(sortTaskRows(rows, sortKey, descending));
  const totals = $derived({
    cpu: Math.round(rows.reduce((sum, row) => sum + row.cpu, 0) * 10) / 10,
    memory: rows.reduce((sum, row) => sum + row.memoryKb, 0),
  });

  async function refresh(): Promise<void> {
    rows = await api.tasks.list().catch(() => rows);
  }

  $effect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), TASKS_REFRESH_MS);
    return () => clearInterval(timer);
  });

  function sortBy(key: TaskSortKey): void {
    if (sortKey === key) descending = !descending;
    else {
      sortKey = key;
      descending = key === "cpu" || key === "memory";
    }
  }

  async function kill(pid: number): Promise<void> {
    await api.tasks.kill(pid).catch(() => false);
    void refresh();
  }

  const COLUMNS: { key: TaskSortKey; label: string; numeric: boolean }[] = [
    { key: "title", label: "Tâche", numeric: false },
    { key: "memory", label: "Mémoire", numeric: true },
    { key: "cpu", label: "Processeur", numeric: true },
    { key: "pid", label: "ID du processus", numeric: true },
  ];
</script>

<Page icon="activity" title="Gestionnaire de tâches" subtitle="Ce que chaque processus du navigateur consomme, actualisé toutes les 2 secondes." testid="tasks-page">
  <Card as="div">
    <table>
      <thead>
        <tr>
          {#each COLUMNS as column (column.key)}
            <th class:numeric={column.numeric} aria-sort={sortKey === column.key ? (descending ? "descending" : "ascending") : "none"}>
              <button onclick={() => sortBy(column.key)}>
                {column.label}
                {#if sortKey === column.key}<Icon name={descending ? "chevron-down" : "chevron-up"} size={12} />{/if}
              </button>
            </th>
          {/each}
          <th><span class="sr-only">Action</span></th>
        </tr>
      </thead>
      <tbody>
        {#each sorted as row (row.pid)}
          <tr data-kind={row.kind}>
            <td>
              <div class="title">
                <span class="name">{row.title}</span>
                {#if row.detail}<span class="detail">{row.detail}</span>{/if}
              </div>
            </td>
            <td class="numeric">{formatMemory(row.memoryKb)}</td>
            <td class="numeric">{row.cpu.toLocaleString("fr-FR")} %</td>
            <td class="numeric">{row.pid}</td>
            <td class="action">
              {#if row.killable}
                <Button size="sm" variant="danger" onclick={() => kill(row.pid)}>Terminer le processus</Button>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
      <tfoot>
        <tr>
          <td>Total</td>
          <td class="numeric">{formatMemory(totals.memory)}</td>
          <td class="numeric">{totals.cpu.toLocaleString("fr-FR")} %</td>
          <td colspan="2"></td>
        </tr>
      </tfoot>
    </table>
  </Card>
</Page>

<style>
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
  }
  th,
  td {
    padding: var(--space-2) var(--space-3);
    text-align: left;
    border-bottom: 1px solid var(--border);
  }
  th button {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 0;
    color: var(--text-muted);
    font-weight: 600;
  }
  .numeric {
    text-align: right;
    white-space: nowrap;
  }
  th.numeric button {
    flex-direction: row-reverse;
  }
  .title {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .name {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .detail {
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
  .action {
    width: 1%;
    text-align: right;
    white-space: nowrap;
  }
  tfoot td {
    border-bottom: 0;
    color: var(--text-muted);
    font-weight: 600;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  @container page (width < 560px) {
    th:nth-child(4),
    td:nth-child(4) {
      display: none;
    }
  }
</style>
