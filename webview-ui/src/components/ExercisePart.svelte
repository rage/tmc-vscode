<script lang="ts">
  import type {
    ExerciseGroup,
    ExerciseStatus,
    MoocExerciseId,
    TmcExerciseId,
  } from "../shared/shared"
  import { ExerciseIdentifier, match } from "../shared/shared"
  import Button from "./Button.svelte"
  import Checkbox from "./Checkbox.svelte"

  // checked/status records for exercises, keyed by the backend-specific exercise id
  type PerBackend<T> = {
    tmc: Record<TmcExerciseId, T>
    mooc: Record<MoocExerciseId, T>
  }

  interface Props {
    exerciseGroup: ExerciseGroup
    onDownloadAll: (exerciseIds: Array<ExerciseIdentifier>) => void
    onOpenAll: (exerciseIds: Array<ExerciseIdentifier>) => void
    onCloseAll: (exerciseIds: Array<ExerciseIdentifier>) => void
    checkedExercises: PerBackend<boolean>
    exerciseStatuses: PerBackend<ExerciseStatus>
  }

  let {
    exerciseGroup,
    onDownloadAll,
    onOpenAll,
    onCloseAll,
    checkedExercises = $bindable(),
    exerciseStatuses,
  }: Props = $props()

  const statusLabels: Record<ExerciseStatus, string> = {
    closed: "Closed",
    downloading: "Downloading",
    downloadFailed: "Download failed",
    expired: "Expired",
    missing: "Not downloaded",
    new: "New",
    opened: "Opened",
  }

  function getStatus(id: ExerciseIdentifier): ExerciseStatus | undefined {
    return match(
      id,
      (tmc) => exerciseStatuses.tmc[tmc.tmcExerciseId],
      (mooc) => exerciseStatuses.mooc[mooc.moocExerciseId],
    )
  }
  function getStatusLabel(id: ExerciseIdentifier): string {
    const status = getStatus(id)
    return status === undefined ? "Loading…" : statusLabels[status]
  }
  function isChecked(id: ExerciseIdentifier): boolean {
    return match(
      id,
      (tmc) => checkedExercises.tmc[tmc.tmcExerciseId] ?? false,
      (mooc) => checkedExercises.mooc[mooc.moocExerciseId] ?? false,
    )
  }
  function setChecked(ids: Array<ExerciseIdentifier>, checked: boolean) {
    const next = { tmc: { ...checkedExercises.tmc }, mooc: { ...checkedExercises.mooc } }
    for (const id of ids) {
      match(
        id,
        (tmc) => {
          next.tmc[tmc.tmcExerciseId] = checked
        },
        (mooc) => {
          next.mooc[mooc.moocExerciseId] = checked
        },
      )
    }
    // reassigned (not mutated) so that the change propagates through the binding
    checkedExercises = next
  }

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
  const allExercisesAreChecked = $derived(
    exerciseGroup.exercises.every((exercise) => isChecked(exercise.id)),
  )
  const someExercisesAreChecked = $derived(
    exerciseGroup.exercises.some((exercise) => isChecked(exercise.id)),
  )

  function getHardDeadlineInformation(deadline: string) {
    return (
      "This is a soft deadline and it can be exceeded. " +
      "Exercises can be submitted after the soft deadline has passed, " +
      "but you receive only 75% of the exercise points. " +
      `Hard deadline for this exercise is: ${deadline}. ` +
      "Hard deadline can not be exceeded."
    )
  }
  function checkAllExercises(checked: boolean) {
    setChecked(
      exerciseGroup.exercises.map((exercise) => exercise.id),
      checked,
    )
  }
</script>

<vscode-collapsible class="exercise-part" heading={exerciseGroup.name}>
  <vscode-badge slot="decorations">Completed {completedExercises}/{totalExercises}</vscode-badge>

  <div class="part-body">
    <vscode-button-group class="part-buttons">
      <Button secondary onclick={() => onDownloadAll(exerciseGroup.exercises.map((e) => e.id))}>
        Download all
      </Button>
      <Button secondary onclick={() => onOpenAll(exerciseGroup.exercises.map((e) => e.id))}>
        Open all
      </Button>
      <Button secondary onclick={() => onCloseAll(exerciseGroup.exercises.map((e) => e.id))}>
        Close all
      </Button>
    </vscode-button-group>

    <div class="part-counts">
      <div>Completed: {completedExercises} / {totalExercises}</div>
      <div>Downloaded: {downloadedExercises} / {totalExercises}</div>
      <div>Opened: {openedExercises} / {totalExercises}</div>
    </div>

    <div class="next-deadline">{exerciseGroup.nextDeadlineString}</div>

    <vscode-table zebra responsive breakpoint="480">
      <vscode-table-header slot="header">
        <vscode-table-header-cell class="checkbox-cell">
          <Checkbox
            aria-label="Select all exercises"
            checked={allExercisesAreChecked}
            indeterminate={someExercisesAreChecked && !allExercisesAreChecked}
            onClick={(checked) => {
              checkAllExercises(checked)
            }}
          />
        </vscode-table-header-cell>
        <vscode-table-header-cell>Exercise</vscode-table-header-cell>
        <vscode-table-header-cell>Deadline</vscode-table-header-cell>
        <vscode-table-header-cell>Completed</vscode-table-header-cell>
        <vscode-table-header-cell>Status</vscode-table-header-cell>
      </vscode-table-header>
      <vscode-table-body slot="body">
        {#each exerciseGroup.exercises as exercise}
          <vscode-table-row id={ExerciseIdentifier.toString(exercise.id)}>
            <vscode-table-cell class="checkbox-cell">
              <Checkbox
                aria-label={exercise.name}
                checked={isChecked(exercise.id)}
                onClick={(checked) => {
                  setChecked([exercise.id], checked)
                }}
              />
            </vscode-table-cell>
            <vscode-table-cell>{exercise.name}</vscode-table-cell>
            <vscode-table-cell>
              {#if exercise.isHard}
                {exercise.hardDeadlineString}
              {:else}
                <span class="soft-deadline">
                  {exercise.softDeadlineString}
                  <span
                    class="deadline-info"
                    title={getHardDeadlineInformation(exercise.hardDeadlineString)}
                  >
                    <vscode-icon name="info"></vscode-icon>
                  </span>
                  <span class="visually-hidden">
                    {getHardDeadlineInformation(exercise.hardDeadlineString)}
                  </span>
                </span>
              {/if}
            </vscode-table-cell>
            <vscode-table-cell>
              {#if exercise.passed}
                <vscode-icon name="pass-filled" class="pass-icon"></vscode-icon>
                <span class="visually-hidden">Passed</span>
              {:else}
                <vscode-icon name="error" class="fail-icon"></vscode-icon>
                <span class="visually-hidden">Not passed</span>
              {/if}
            </vscode-table-cell>
            <vscode-table-cell>
              <vscode-badge>{getStatusLabel(exercise.id)}</vscode-badge>
            </vscode-table-cell>
          </vscode-table-row>
        {/each}
      </vscode-table-body>
    </vscode-table>
  </div>
</vscode-collapsible>

<style>
  .exercise-part {
    display: block;
    margin-bottom: 1rem;
  }
  .part-body {
    padding: 0.4rem;
  }
  .part-buttons {
    display: block;
    width: 100%;
    margin-bottom: 0.8rem;
  }
  .part-counts {
    margin-bottom: 0.4rem;
  }
  .next-deadline {
    margin-bottom: 0.8rem;
  }
  .checkbox-cell {
    width: 2rem;
  }
  .soft-deadline {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
  }
  .deadline-info {
    display: inline-flex;
    cursor: help;
  }
  .pass-icon {
    color: var(--vscode-testing-iconPassed, #73c991);
  }
  .fail-icon {
    color: var(--vscode-testing-iconFailed, #f14c4c);
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
