<script lang="ts">
  import { onMount } from "svelte"

  import type {
    ExerciseSubmissionPanel,
    SubmissionHistoryEntry,
    TargetPanel,
    WebviewError,
  } from "../../../../shared/lib"
  import Button from "../../components/Button.svelte"
  import ErrorNotice from "../../components/ErrorNotice.svelte"
  import Spinner from "../../components/Spinner.svelte"
  import { announce } from "../../utilities/a11y.svelte"
  import { addMessageListener, createRequester } from "../../utilities/script"

  interface Props {
    /** The host lists and restores the submissions of the exercise `sourcePanel` shows. */
    sourcePanel: TargetPanel<ExerciseSubmissionPanel>
    /** Why nothing can be restored now, as a sentence; restoring is offered when absent. */
    restoreRefusal?: string | undefined
  }

  /** The body of the History section: an exercise's earlier submissions, to restore one. */
  let { sourcePanel, restoreRefusal }: Props = $props()

  const request = createRequester()

  let entries = $state.raw<SubmissionHistoryEntry[] | undefined>(undefined)
  let loadError = $state<WebviewError | undefined>(undefined)
  // Asked for, and waiting on the host's confirmation modal; `restoringKey` once confirmed.
  let requestedKey = $state<string | undefined>(undefined)
  let restoringKey = $state<string | undefined>(undefined)
  let restoreError = $state<WebviewError | undefined>(undefined)
  let restoreNote = $state<string | undefined>(undefined)

  const graded = $derived(entries?.filter((entry) => entry.kind === "submission") ?? [])
  const ungraded = $derived(entries?.filter((entry) => entry.kind !== "submission") ?? [])

  const KIND_LABELS: Record<SubmissionHistoryEntry["kind"], string> = {
    submission: "Submission",
    paste: "Help request",
    backup: "Backup",
    unrecognized: "Other",
  }

  onMount(() => void load())
  // svelte-ignore state_referenced_locally -- the panel never changes: a new one remounts
  addMessageListener(sourcePanel as ExerciseSubmissionPanel, (message) => {
    if (message.type === "restoreConfirmed" && message.key === requestedKey) {
      restoringKey = message.key
    }
  })

  let isLoading = false

  /** Lists the submissions again, e.g. for a refresh control outside this component. */
  export async function load() {
    if (isLoading) {
      return
    }
    isLoading = true
    loadError = undefined
    entries = undefined
    const outcome = await request("requestSubmissionHistory", { sourcePanel })
    isLoading = false
    if (outcome.ok) {
      entries = outcome.value
      announce(
        outcome.value.length === 0
          ? "No earlier submissions"
          : `${outcome.value.length} earlier ${outcome.value.length === 1 ? "entry" : "entries"}`,
      )
    } else {
      loadError = outcome.error
    }
  }

  async function restore(entry: SubmissionHistoryEntry) {
    requestedKey = entry.key
    restoreError = undefined
    restoreNote = undefined
    const outcome = await request("restoreSubmission", { sourcePanel, key: entry.key })
    requestedKey = undefined
    restoringKey = undefined
    if (!outcome.ok) {
      restoreError = outcome.error
      return
    }
    switch (outcome.value) {
      case "restored":
        restoreNote = `Restored the ${KIND_LABELS[entry.kind].toLowerCase()} from ${entry.dateLabel}.`
        // A backup made first is a new entry.
        void load()
        break
      case "nothingToDownload":
        restoreNote = "That submission has no files to download."
        break
      case "cancelled":
        return
    }
    announce(restoreNote ?? "")
  }

  function iconOf(entry: SubmissionHistoryEntry): { name: string; tone?: "passed" } {
    switch (entry.kind) {
      case "paste":
        return { name: "comment-discussion" }
      case "backup":
        return { name: "archive" }
      case "unrecognized":
        return { name: "question" }
      case "submission":
        return entry.isPassed ? { name: "pass", tone: "passed" } : { name: "circle-large-outline" }
    }
  }

  function scoreOf({ points }: SubmissionHistoryEntry): string | undefined {
    if (points === undefined) {
      return undefined
    }
    return points.max > 0 ? `${points.given} / ${points.max} points` : `score ${points.given}`
  }
</script>

{#snippet rows(list: SubmissionHistoryEntry[])}
  <ul class="rows">
    {#each list as entry (entry.key)}
      {@const icon = iconOf(entry)}
      {@const score = scoreOf(entry)}
      <li class="row">
        <vscode-icon
          class="icon"
          class:passed={icon.tone === "passed"}
          name={icon.name}
          aria-hidden="true"
        ></vscode-icon>
        <span class="text">
          <span class="date">
            <time datetime={entry.createdAt}>{entry.dateLabel}</time>
            {#if entry.isNewestGraded}<span class="badge">Latest submission</span>{/if}
          </span>
          <span class="muted">
            {[KIND_LABELS[entry.kind], score, entry.status, entry.isShared ? "Shared" : undefined]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </span>
        {#if restoreRefusal === undefined}
          <span class="restore">
            {#if restoringKey === entry.key}
              <Spinner label="Restoring…" />
            {:else}
              <Button
                secondary
                disabled={requestedKey !== undefined}
                aria-label="Restore the {KIND_LABELS[
                  entry.kind
                ].toLowerCase()} from {entry.dateLabel}"
                onclick={() => restore(entry)}>Restore</Button
              >
            {/if}
          </span>
        {/if}
      </li>
    {/each}
  </ul>
{/snippet}

{#if restoreRefusal}<p class="muted refusal">{restoreRefusal}</p>{/if}
{#if restoreNote}
  <p>{restoreNote}</p>
{/if}
{#if restoreError}
  <ErrorNotice error={restoreError} title="Could not restore the submission" />
{/if}
{#if loadError}
  <ErrorNotice error={loadError} title="Could not list the submissions">
    {#snippet actions()}
      <Button secondary onclick={load}>Try Again</Button>
    {/snippet}
  </ErrorNotice>
{:else if entries === undefined}
  <Spinner label="Loading submissions…" />
{:else if entries.length === 0}
  <p>No earlier submissions yet.</p>
{:else if graded.length === 0 || ungraded.length === 0}
  {@render rows(entries)}
{:else}
  <h3>Submissions</h3>
  {@render rows(graded)}
  <h3>Help requests and backups</h3>
  {@render rows(ungraded)}
{/if}

<style>
  .refusal {
    margin: 0 0 var(--tmc-space-2);
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--tmc-space-3);
    padding: var(--tmc-space-1) var(--tmc-space-2);
    border-radius: var(--tmc-radius);
  }
  .row:hover {
    background: var(--tmc-list-hover);
  }
  .icon {
    flex: none;
  }
  .passed {
    color: var(--tmc-status-passed);
  }
  .text {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .date {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--tmc-space-2);
  }
  .badge {
    padding: 0 6px;
    border-radius: 9px;
    font-size: 11px;
    line-height: 16px;
    background: var(--tmc-badge-background);
    color: var(--tmc-badge-foreground);
    outline: 1px solid var(--tmc-hc-outline);
  }
  .restore {
    flex: none;
  }
  h3 {
    margin: var(--tmc-space-3) 0 var(--tmc-space-1);
  }
</style>
