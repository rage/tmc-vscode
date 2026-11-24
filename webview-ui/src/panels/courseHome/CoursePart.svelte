<script lang="ts">
  import { SvelteSet } from "svelte/reactivity"

  import type {
    CourseHomeExercise,
    CourseHomeExerciseAction,
    CourseHomePart,
  } from "../../../../shared/lib"
  import { ExerciseIdentifier, SUBMIT_REFUSAL_ICONS } from "../../../../shared/lib"
  import ActionMenu from "../../components/ActionMenu.svelte"
  import ToolbarButton from "../../components/ToolbarButton.svelte"
  import { reducedMotion } from "../../utilities/a11y.svelte"

  interface Props {
    part: CourseHomePart
    /** BCP 47 tag of the language of the part's and exercises' names. */
    lang?: string | undefined
    /** This window is the course's workspace, where an opened exercise is a folder of it. */
    isWorkspaceOpen: boolean
    /** Whether a download can succeed now: logged in, and the backend reachable. */
    canDownload: boolean
    isExpanded: boolean
    ontoggle: () => void
    onaction: (exercise: CourseHomeExercise, action: CourseHomeExerciseAction) => void
    /** Opens an exercise's course material or model solution page in the browser. */
    onopenmaterial: (url: string) => void
  }

  /** One part of the course: a header with its progress, and a row per exercise. */
  let {
    part,
    lang,
    isWorkspaceOpen,
    canDownload,
    isExpanded,
    ontoggle,
    onaction,
    onopenmaterial,
  }: Props = $props()

  const headingId = $props.id()
  // Rows whose exact deadline is shown under them.
  const expandedDeadlines = new SvelteSet<string>()

  function toggleDeadline(key: string) {
    if (!expandedDeadlines.delete(key)) {
      expandedDeadlines.add(key)
    }
  }
  const passedCount = $derived(part.exercises.filter((ex) => ex.passed).length)

  const STATE_LABELS: Record<Exclude<CourseHomeExercise["status"], "opened">, string> = {
    closed: "Closed",
    missing: "Not downloaded",
    new: "New",
    downloading: "Downloading…",
    downloadFailed: "Download failed",
    expired: "Deadline passed",
    removed: "Removed",
    browserOnly: "On the course page",
  }

  function stateLabel(exercise: CourseHomeExercise): string {
    if (exercise.status === "opened") {
      return isWorkspaceOpen ? "In workspace" : "Downloaded"
    }
    return STATE_LABELS[exercise.status]
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
    if (exercise.pendingReview) {
      const { icon, sentence } = exercise.pendingReview
      return { name: icon, tone: "muted", label: sentence }
    }
    if (exercise.submitRefusal) {
      const { icon, sentence } = exercise.submitRefusal
      return { name: icon, tone: "muted", label: sentence }
    }
    if (exercise.status === "expired") {
      return { name: SUBMIT_REFUSAL_ICONS.deadlinePassed, tone: "muted", label: "Deadline passed" }
    }
    return { name: "circle-large-outline", tone: "muted", label: "Not passed" }
  }

  function points(exercise: CourseHomeExercise): string {
    // Held at 0 until the review; the deadline column says so instead.
    return exercise.availablePoints > 0 && (!exercise.pendingReview || exercise.awardedPoints > 0)
      ? `${exercise.awardedPoints}/${exercise.availablePoints}`
      : ""
  }

  /** The deadline is still ahead and the exercise still open to work on. */
  function isDue(exercise: CourseHomeExercise): boolean {
    return (
      exercise.deadline !== undefined &&
      !exercise.passed &&
      !exercise.submitRefusal &&
      Date.parse(exercise.deadline.at) > Date.now()
    )
  }

  /** Why an unpassed exercise cannot be submitted, unless its state already says so. */
  function shownRefusal(exercise: CourseHomeExercise) {
    return exercise.passed || exercise.status === "expired" ? undefined : exercise.submitRefusal
  }

  function triesLeftText(triesLeft: number): string {
    return `${triesLeft} ${triesLeft === 1 ? "try" : "tries"} left`
  }

  function menuActions(exercise: CourseHomeExercise) {
    const { materialUrl, solutionUrl } = exercise
    return [
      ...(isOnDisk(exercise)
        ? [
            { label: "Reset Exercise…", onselect: () => onaction(exercise, "reset") },
            {
              label: "History",
              onselect: () => onaction(exercise, "downloadOldSubmission"),
            },
          ]
        : []),
      ...(solutionUrl
        ? [{ label: "Show Model Solution", onselect: () => onopenmaterial(solutionUrl) }]
        : materialUrl
          ? [{ label: "Open Course Material", onselect: () => onopenmaterial(materialUrl) }]
          : []),
    ]
  }
</script>

<section class="part" aria-labelledby={headingId}>
  <div class="part-header">
    <h2 id={headingId}>
      <button
        type="button"
        class="part-toggle"
        aria-expanded={isExpanded}
        aria-controls="{headingId}-rows"
        onclick={ontoggle}
      >
        <vscode-icon name={isExpanded ? "chevron-down" : "chevron-right"}></vscode-icon>
        <span {lang}>{part.name}</span>
      </button>
    </h2>
    <span class="muted part-progress">{passedCount}/{part.exercises.length} passed</span>
    {#if part.locked}
      <span class="muted part-locked">
        <vscode-icon name={part.locked.icon} aria-hidden="true"></vscode-icon>
        <span>{part.locked.reason}</span>
      </span>
    {/if}
  </div>
  {#if isExpanded}
    <ul class="rows" id="{headingId}-rows">
      {#each part.exercises as exercise (ExerciseIdentifier.key(exercise.id))}
        {@const icon = statusIcon(exercise)}
        {@const actions = menuActions(exercise)}
        {@const refusal = shownRefusal(exercise)}
        {@const rowKey = ExerciseIdentifier.key(exercise.id)}
        {@const dueDeadline = exercise.deadline && isDue(exercise) ? exercise.deadline : undefined}
        {@const reason = exercise.pendingReview ?? refusal}
        {@const tries =
          !refusal && !exercise.passed && exercise.triesLeft !== undefined
            ? triesLeftText(exercise.triesLeft)
            : undefined}
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
            {#if isDownloadable(exercise) && !canDownload}
              <!-- Opening it would download it, which the notices say cannot happen now. -->
              <span class="name-text" {lang} title={exercise.name}>{exercise.name}</span>
            {:else}
              <button
                type="button"
                class="name-text name-button"
                {lang}
                title={exercise.name}
                disabled={exercise.status === "downloading"}
                onclick={() => onaction(exercise, "open")}
              >
                {exercise.name}
              </button>
            {/if}
            {#if exercise.isUpdateable}<span class="badge">update</span>{/if}
          </span>
          <span class="state muted">{stateLabel(exercise)}</span>
          <span class="deadline muted">
            {#if exercise.pendingReview}
              <span>{exercise.pendingReview.label}</span>
            {:else if refusal}
              <span>{refusal.label}</span>
            {:else if dueDeadline}
              <button
                type="button"
                class="deadline-toggle"
                aria-expanded={expandedDeadlines.has(rowKey)}
                aria-controls="{headingId}-{rowKey}-detail"
                onclick={() => toggleDeadline(rowKey)}
              >
                <time datetime={dueDeadline.at}>
                  {exercise.isSoftDeadline ? "soft deadline" : "due"}
                  {dueDeadline.brief}
                </time>
              </button>
            {/if}
            {#if tries}
              <span>{tries}</span>
            {/if}
          </span>
          <span class="points">
            {points(exercise)}{#if points(exercise)}<span class="visually-hidden">
                points</span
              >{/if}
          </span>
          <span class="row-actions">
            {#if isDownloadable(exercise) && canDownload}
              <ToolbarButton
                icon="cloud-download"
                label="Download {exercise.name}"
                onclick={() => onaction(exercise, "download")}
              />
            {:else if isOnDisk(exercise)}
              <ToolbarButton
                icon="edit"
                label="Open {exercise.name}"
                onclick={() => onaction(exercise, "open")}
              />
            {/if}
            {#if actions.length > 0}
              <ActionMenu label="More Actions for {exercise.name}" {actions} />
            {/if}
          </span>
          {#if reason}
            <!-- The icon's hidden label already says it to a screen reader. -->
            <span class="detail muted" aria-hidden="true">{reason.sentence}</span>
          {:else if dueDeadline && expandedDeadlines.has(rowKey)}
            <span class="detail muted" id="{headingId}-{rowKey}-detail">
              {exercise.isSoftDeadline ? "Soft deadline" : "Deadline"}: {dueDeadline.absolute}
            </span>
          {/if}
          {#if exercise.reviewNote || exercise.teacherReview || exercise.instructions}
            <div class="row-notes">
              {#if exercise.reviewNote}
                <p>{exercise.reviewNote}</p>
              {/if}
              {#if exercise.teacherReview}
                <p>{exercise.teacherReview.sentence}</p>
                {#if exercise.teacherReview.justification}
                  <blockquote>{exercise.teacherReview.justification}</blockquote>
                {/if}
              {/if}
              {#if exercise.instructions}
                <details>
                  <summary>Instructions</summary>
                  {#each exercise.instructions as paragraph, i (i)}
                    <p class="instructions">{paragraph}</p>
                  {/each}
                </details>
              {/if}
            </div>
          {/if}
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
    flex-wrap: wrap;
    align-items: center;
    gap: var(--tmc-space-2);
    border-bottom: 1px solid var(--tmc-section-header-border);
    padding-bottom: var(--tmc-space-1);
  }
  /* A name too long to share its line pushes the progress onto the next. */
  .part-header h2 {
    flex: 1 1 auto;
    min-width: 0;
    margin: 0;
    overflow-wrap: break-word;
  }
  .part-toggle {
    display: flex;
    align-items: center;
    gap: var(--tmc-space-1);
    width: 100%;
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    letter-spacing: inherit;
    text-align: start;
    text-transform: inherit;
    cursor: pointer;
  }
  /* Inside the row, as VS Code rings a focused list row. */
  .part-toggle:focus-visible {
    outline-offset: -1px;
  }
  .part-progress {
    flex: none;
    font-variant-numeric: tabular-nums;
  }
  /* Its own line under the name: a sentence, unlike the counts beside the name. */
  .part-locked {
    display: flex;
    flex-basis: 100%;
    align-items: flex-start;
    gap: var(--tmc-space-1);
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .row {
    display: grid;
    grid-template-columns: 16px minmax(8ch, 1fr) 9em 12em 3em 48px;
    align-items: center;
    column-gap: var(--tmc-space-3);
    min-height: var(--tmc-list-row-height, 22px);
    padding: 1px var(--tmc-space-2);
    border-radius: var(--tmc-radius);
  }
  .row:hover {
    background: var(--tmc-list-hover);
  }
  .row-notes {
    grid-column: 2 / -1;
  }
  .row-notes p,
  .row-notes blockquote {
    margin: var(--tmc-space-1) 0;
  }
  .instructions {
    white-space: pre-wrap;
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
  .name-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .name-button {
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: start;
    cursor: pointer;
  }
  .name-button:hover:not(:disabled) {
    text-decoration: underline;
  }
  .is-passive .name-text {
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
  .state {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* Wraps instead of truncating: what a student may still submit must stay readable. */
  .deadline {
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow-wrap: break-word;
  }
  .deadline-toggle {
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: start;
    text-decoration: underline dotted;
    cursor: pointer;
  }
  /* A sentence under the row, wrapped, for what the columns have no room for. */
  .detail {
    grid-row: 2;
    grid-column: 2 / -1;
    overflow-wrap: break-word;
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
  /* The state goes first: the icons and the muted names of exercises not on disk tell most of it. */
  @media (max-width: 640px) {
    .row {
      grid-template-columns: 16px minmax(8ch, 1fr) 10em 3em 48px;
    }
    .state {
      display: none;
    }
  }
  @media (max-width: 420px) {
    .row {
      grid-template-columns: 16px minmax(8ch, 1fr) 3em 48px;
    }
    /* Under the name, as the row has no room for a column of its own. */
    .deadline {
      grid-row: 2;
      grid-column: 2 / -1;
      flex-direction: row;
      flex-wrap: wrap;
      column-gap: var(--tmc-space-1);
    }
    .detail {
      grid-row: 3;
    }
    .deadline > * + *::before {
      content: "· ";
    }
    /* Names that differ only at the end must not be cut to the same prefix. */
    .name-button {
      white-space: normal;
      overflow-wrap: anywhere;
    }
  }
  @media (max-width: 300px) {
    .row {
      grid-template-columns: 16px minmax(8ch, 1fr) 48px;
      column-gap: var(--tmc-space-2);
    }
    .points {
      display: none;
    }
  }
</style>
