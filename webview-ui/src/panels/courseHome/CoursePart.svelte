<script lang="ts">
  import type {
    CourseHomeExercise,
    CourseHomeExerciseAction,
    CourseHomePart,
  } from "../../../../shared/lib"
  import { ExerciseIdentifier } from "../../../../shared/lib"
  import ActionMenu from "../../components/ActionMenu.svelte"
  import ToolbarButton from "../../components/ToolbarButton.svelte"
  import { reducedMotion } from "../../utilities/a11y.svelte"

  interface Props {
    part: CourseHomePart
    isExpanded: boolean
    ontoggle: () => void
    onaction: (exercise: CourseHomeExercise, action: CourseHomeExerciseAction) => void
  }

  /** One part of the course: a header with its progress, and a row per exercise. */
  let { part, isExpanded, ontoggle, onaction }: Props = $props()

  const headingId = $props.id()
  const passedCount = $derived(part.exercises.filter((ex) => ex.passed).length)

  const STATE_LABELS: Record<CourseHomeExercise["status"], string> = {
    opened: "Open",
    closed: "Closed",
    missing: "Not downloaded",
    new: "New",
    downloading: "Downloading…",
    downloadFailed: "Download failed",
    expired: "Expired",
  }

  function isOnDisk(exercise: CourseHomeExercise): boolean {
    return exercise.status === "opened" || exercise.status === "closed"
  }

  function isDownloadable(exercise: CourseHomeExercise): boolean {
    return ["missing", "new", "expired", "downloadFailed"].includes(exercise.status)
  }

  function statusIcon(exercise: CourseHomeExercise): { name: string; tone: string; label: string } {
    if (exercise.status === "downloading") {
      return { name: "loading", tone: "muted", label: "Downloading" }
    }
    if (exercise.status === "downloadFailed") {
      return { name: "error", tone: "failed", label: "Download failed" }
    }
    if (exercise.passed) {
      return { name: "pass-filled", tone: "passed", label: "Passed" }
    }
    if (exercise.isOutOfTries) {
      return { name: "circle-slash", tone: "muted", label: "No tries left" }
    }
    if (exercise.status === "expired") {
      return { name: "lock", tone: "muted", label: "Expired" }
    }
    return { name: "circle-large-outline", tone: "muted", label: "Not passed" }
  }

  function points(exercise: CourseHomeExercise): string {
    return exercise.availablePoints > 0
      ? `${exercise.awardedPoints}/${exercise.availablePoints}`
      : ""
  }

  /** The deadline is still ahead and the exercise still open to work on. */
  function isDue(exercise: CourseHomeExercise): boolean {
    return (
      exercise.deadline !== undefined &&
      !exercise.passed &&
      !exercise.isOutOfTries &&
      Date.parse(exercise.deadline.at) > Date.now()
    )
  }

  function menuActions(exercise: CourseHomeExercise) {
    if (!isOnDisk(exercise)) {
      return []
    }
    return [
      { label: "Reset Exercise…", onselect: () => onaction(exercise, "reset") },
      {
        label: "Download Old Submission…",
        onselect: () => onaction(exercise, "downloadOldSubmission"),
      },
    ]
  }
</script>

<section class="part" aria-labelledby={headingId}>
  <div class="part-header">
    <button
      type="button"
      class="part-toggle"
      aria-expanded={isExpanded}
      aria-controls="{headingId}-rows"
      onclick={ontoggle}
    >
      <vscode-icon name={isExpanded ? "chevron-down" : "chevron-right"}></vscode-icon>
      <h2 id={headingId}>{part.name}</h2>
    </button>
    <span class="muted part-progress">{passedCount}/{part.exercises.length} passed</span>
  </div>
  {#if isExpanded}
    <ul class="rows" id="{headingId}-rows">
      {#each part.exercises as exercise (ExerciseIdentifier.key(exercise.id))}
        {@const icon = statusIcon(exercise)}
        <li class="row" class:is-passive={!isOnDisk(exercise)}>
          <span class="icon" title={icon.label}>
            <vscode-icon
              class="tone-{icon.tone}"
              name={icon.name}
              spin={exercise.status === "downloading" && !reducedMotion.current}
            ></vscode-icon>
            <span class="visually-hidden">{icon.label}</span>
          </span>
          <span class="name">
            <button
              type="button"
              class="name-button"
              disabled={exercise.status === "downloading"}
              onclick={() => onaction(exercise, "open")}
            >
              {exercise.name}
            </button>
            {#if exercise.isUpdateable}<span class="badge">update</span>{/if}
          </span>
          <span class="state muted">{STATE_LABELS[exercise.status]}</span>
          <span class="deadline muted">
            {#if exercise.deadline && isDue(exercise)}
              <time
                datetime={exercise.deadline.at}
                title="{exercise.isSoftDeadline ? 'Soft deadline' : 'Deadline'}: {exercise.deadline
                  .absolute}"
              >
                {exercise.isSoftDeadline ? "soft deadline" : "due"}
                {exercise.deadline.relative}
              </time>
            {/if}
          </span>
          <span
            class="points"
            aria-label={points(exercise) ? `${points(exercise)} points` : undefined}
            >{points(exercise)}</span
          >
          <span class="row-actions">
            {#if isDownloadable(exercise)}
              <ToolbarButton
                icon="cloud-download"
                label="Download {exercise.name}"
                onclick={() => onaction(exercise, "download")}
              />
            {:else if isOnDisk(exercise)}
              <ToolbarButton
                icon="go-to-file"
                label="Open {exercise.name}"
                onclick={() => onaction(exercise, "open")}
              />
            {/if}
            {#if isOnDisk(exercise)}
              <ActionMenu
                label="More Actions for {exercise.name}"
                actions={menuActions(exercise)}
              />
            {/if}
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .part {
    margin-top: var(--tmc-space-4);
  }
  .part-header {
    display: flex;
    align-items: center;
    gap: var(--tmc-space-2);
    border-bottom: 1px solid var(--tmc-section-header-border);
    padding-bottom: var(--tmc-space-1);
  }
  .part-toggle {
    display: flex;
    align-items: center;
    gap: var(--tmc-space-1);
    flex: 1;
    min-width: 0;
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: start;
    cursor: pointer;
  }
  .part-toggle h2 {
    margin: 0;
  }
  .part-progress {
    flex: none;
    font-variant-numeric: tabular-nums;
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .row {
    display: grid;
    grid-template-columns: 16px minmax(0, 1fr) 9em 12em 3em 48px;
    align-items: center;
    column-gap: var(--tmc-space-3);
    min-height: var(--tmc-list-row-height, 22px);
    padding: 1px var(--tmc-space-2);
    border-radius: var(--tmc-radius);
  }
  .row:hover {
    background: var(--tmc-list-hover);
  }
  .icon {
    display: inline-flex;
  }
  .tone-passed {
    color: var(--tmc-status-passed);
  }
  .tone-failed {
    color: var(--tmc-status-failed);
  }
  .tone-muted {
    color: var(--tmc-fg-muted);
  }
  .name {
    display: flex;
    align-items: center;
    gap: var(--tmc-space-2);
    min-width: 0;
  }
  .name-button {
    min-width: 0;
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: start;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }
  .name-button:hover:not(:disabled) {
    text-decoration: underline;
  }
  .is-passive .name-button {
    color: var(--tmc-fg-muted);
  }
  .badge {
    flex: none;
    padding: 0 6px;
    border-radius: 9px;
    font-size: 11px;
    line-height: 16px;
    background: var(--tmc-badge-background);
    color: var(--tmc-badge-foreground);
    outline: 1px solid var(--tmc-hc-outline);
  }
  .state,
  .deadline {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .points {
    text-align: end;
    font-variant-numeric: tabular-nums;
  }
  /* Two fixed slots, so the download and open icons line up whether or not a row has a "⋯". */
  .row-actions {
    display: grid;
    grid-template-columns: 22px 22px;
    align-items: center;
    gap: var(--tmc-space-1);
  }
  /* Like the tree's inline actions: the overflow appears with the row's hover or focus. */
  .row:not(:hover, :focus-within) .row-actions :global(.action-menu) {
    opacity: 0;
  }
  @media (max-width: 640px) {
    .row {
      grid-template-columns: 16px minmax(0, 1fr) 9em 3em 48px;
    }
    .deadline {
      display: none;
    }
  }
  @media (max-width: 420px) {
    .row {
      grid-template-columns: 16px minmax(0, 1fr) 3em 48px;
    }
    .state {
      display: none;
    }
  }
</style>
