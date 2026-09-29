<script lang="ts">
  import { untrack } from "svelte"
  import type { SvelteMap } from "svelte/reactivity"

  import type {
    ExerciseGroup,
    ExerciseStatus,
    MoocExerciseId,
    TmcExerciseId,
  } from "../shared/shared"
  import { ExerciseIdentifier, match } from "../shared/shared"
  import Button from "./Button.svelte"
  import Checkbox from "./Checkbox.svelte"
  import Disclosure from "./Disclosure.svelte"
  import StatusIcon from "./StatusIcon.svelte"
  import type { Status } from "./StatusIcon.svelte"

  // exercise statuses, keyed by the backend-specific exercise id
  type PerBackend<T> = {
    tmc: Record<TmcExerciseId, T>
    mooc: Record<MoocExerciseId, T>
  }

  interface Props {
    exerciseGroup: ExerciseGroup
    onDownloadAll: (exerciseIds: Array<ExerciseIdentifier>) => void
    onOpenAll: (exerciseIds: Array<ExerciseIdentifier>) => void
    onCloseAll: (exerciseIds: Array<ExerciseIdentifier>) => void
    // The panel's selection, mutated in place: a `SvelteMap` propagates its own changes.
    checkedExercises: SvelteMap<string, ExerciseIdentifier>
    exerciseStatuses: PerBackend<ExerciseStatus>
  }

  let {
    exerciseGroup,
    onDownloadAll,
    onOpenAll,
    onCloseAll,
    checkedExercises,
    exerciseStatuses,
  }: Props = $props()

  // Seeded once: a re-posted group must not collapse a part the user opened.
  let isOpen = $state(untrack(() => exerciseGroup.defaultOpen ?? true))

  const statusAppearances: Record<ExerciseStatus, { status: Status; label: string }> = {
    closed: { status: "closed", label: "Closed" },
    downloading: { status: "downloading", label: "Downloading" },
    downloadFailed: { status: "downloadFailed", label: "Download failed" },
    expired: { status: "expired", label: "Expired" },
    missing: { status: "missing", label: "Not downloaded" },
    new: { status: "missing", label: "New" },
    opened: { status: "opened", label: "Opened" },
  }

  function getStatus(id: ExerciseIdentifier): ExerciseStatus | undefined {
    return match(
      id,
      (tmc) => exerciseStatuses.tmc[tmc.tmcExerciseId],
      (mooc) => exerciseStatuses.mooc[mooc.moocExerciseId],
    )
  }
  function isChecked(id: ExerciseIdentifier): boolean {
    return checkedExercises.has(ExerciseIdentifier.toString(id))
  }
  function setChecked(ids: Array<ExerciseIdentifier>, checked: boolean) {
    for (const id of ids) {
      const key = ExerciseIdentifier.toString(id)
      if (checked) {
        checkedExercises.set(key, id)
      } else {
        checkedExercises.delete(key)
      }
    }
  }

  const exerciseIds = $derived(exerciseGroup.exercises.map((exercise) => exercise.id))
  const completedExercises = $derived(exerciseGroup.exercises.filter((e) => e.passed).length)
  const downloadedExercises = $derived(
    exerciseGroup.exercises.filter((e) => {
      const status = getStatus(e.id)
      return status === "opened" || status === "closed"
    }).length,
  )
  const openedExercises = $derived(
    exerciseGroup.exercises.filter((e) => getStatus(e.id) === "opened").length,
  )
  const totalExercises = $derived(exerciseGroup.exercises.length)
  const allExercisesAreChecked = $derived(exerciseIds.every((id) => isChecked(id)))
  const someExercisesAreChecked = $derived(exerciseIds.some((id) => isChecked(id)))
</script>

<Disclosure
  title={exerciseGroup.name}
  bind:open={isOpen}
  description={`${completedExercises} / ${totalExercises} completed`}
>
  <div class="actions part-actions">
    <Button
      secondary
      icon="cloud-download"
      aria-label={`Download all in ${exerciseGroup.name}`}
      disabled={downloadedExercises === totalExercises}
      onclick={() => onDownloadAll(exerciseIds)}
    >
      Download all
    </Button>
    <Button
      secondary
      icon="folder-opened"
      aria-label={`Open all in ${exerciseGroup.name}`}
      disabled={openedExercises === totalExercises}
      onclick={() => onOpenAll(exerciseIds)}
    >
      Open all
    </Button>
    <Button
      secondary
      icon="close-all"
      aria-label={`Close all in ${exerciseGroup.name}`}
      disabled={openedExercises === 0}
      onclick={() => onCloseAll(exerciseIds)}
    >
      Close all
    </Button>
  </div>

  <p class="next-deadline muted">{exerciseGroup.nextDeadlineString}</p>

  <vscode-table zebra responsive breakpoint={480} columns={["32px", "auto", "200px", "160px"]}>
    <!-- The library leaves the header cells without a row, which breaks header/cell association. -->
    <vscode-table-header slot="header" role="row">
      <vscode-table-header-cell>
        <Checkbox
          accessibleName={`Select all in ${exerciseGroup.name}`}
          checked={allExercisesAreChecked}
          indeterminate={someExercisesAreChecked && !allExercisesAreChecked}
          oncheckedchange={(checked) => {
            setChecked(exerciseIds, checked)
          }}
        />
      </vscode-table-header-cell>
      <vscode-table-header-cell>Exercise</vscode-table-header-cell>
      <vscode-table-header-cell>Deadline</vscode-table-header-cell>
      <vscode-table-header-cell>Status</vscode-table-header-cell>
    </vscode-table-header>
    <vscode-table-body slot="body">
      {#each exerciseGroup.exercises as exercise (ExerciseIdentifier.toString(exercise.id))}
        {@const status = getStatus(exercise.id)}
        <vscode-table-row id={ExerciseIdentifier.toString(exercise.id)}>
          <vscode-table-cell>
            <Checkbox
              accessibleName={`Select ${exercise.name}`}
              checked={isChecked(exercise.id)}
              oncheckedchange={(checked) => {
                setChecked([exercise.id], checked)
              }}
            />
          </vscode-table-cell>
          <vscode-table-cell>{exercise.name}</vscode-table-cell>
          <vscode-table-cell>
            <time datetime={exercise.deadlineIso ?? undefined}>
              {exercise.isHard ? exercise.hardDeadlineString : exercise.softDeadlineString}
            </time>
            {#if !exercise.isHard}
              <span class="hard-deadline muted">hard: {exercise.hardDeadlineString}</span>
            {/if}
          </vscode-table-cell>
          <vscode-table-cell>
            <span class="status">
              <StatusIcon
                status={exercise.passed ? "passed" : "unset"}
                label={exercise.passed ? "Passed" : "Not passed"}
                isLabelHidden
              />
              {#if status === undefined}
                <span class="muted">Loading…</span>
              {:else}
                <StatusIcon {...statusAppearances[status]} />
              {/if}
            </span>
          </vscode-table-cell>
        </vscode-table-row>
      {/each}
    </vscode-table-body>
  </vscode-table>
</Disclosure>

<style>
  .part-actions {
    margin-bottom: var(--tmc-space-2);
  }
  .next-deadline {
    margin: 0 0 var(--tmc-space-2);
  }
  .hard-deadline {
    display: block;
  }
  .status {
    display: inline-flex;
    align-items: center;
    gap: var(--tmc-space-2);
  }
</style>
