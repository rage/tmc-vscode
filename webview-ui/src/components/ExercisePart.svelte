<script lang="ts">
  import { writable } from "svelte/store"

  import type {
    ExerciseGroup,
    ExerciseStatus,
    MoocExerciseId,
    TmcExerciseId,
  } from "../shared/shared"
  import { ExerciseIdentifier, match } from "../shared/shared"
  import Card from "./Card.svelte"
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

  const expanded = writable<boolean>(false)

  function getStatus(id: ExerciseIdentifier): ExerciseStatus | undefined {
    return match(
      id,
      (tmc) => exerciseStatuses.tmc[tmc.tmcExerciseId],
      (mooc) => exerciseStatuses.mooc[mooc.moocExerciseId],
    )
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

  function getHardDeadlineInformation(deadline: string) {
    return (
      "This is a soft deadline and it can be exceeded." +
      "&#013Exercises can be submitted after the soft deadline has passed, " +
      "but you receive only 75% of the exercise points." +
      `&#013;Hard deadline for this exercise is: ${deadline}.` +
      "&#013;Hard deadline can not be exceeded."
    )
  }
  function checkAllExercises(checked: boolean) {
    setChecked(
      exerciseGroup.exercises.map((exercise) => exercise.id),
      checked,
    )
  }
</script>

<Card>
  <div class="part-header">
    <h2 class="part-title">
      {exerciseGroup.name}
    </h2>
    <div class="part-buttons">
      <vscode-button
        role="button"
        tabindex="0"
        class="part-button"
        secondary
        onclick={() => onDownloadAll(exerciseGroup.exercises.map((e) => e.id))}
        onkeypress={() => onDownloadAll(exerciseGroup.exercises.map((e) => e.id))}
      >
        Download all
      </vscode-button>
      <vscode-button
        role="button"
        tabindex="0"
        class="part-button"
        secondary
        onclick={() => onOpenAll(exerciseGroup.exercises.map((e) => e.id))}
        onkeypress={() => onOpenAll(exerciseGroup.exercises.map((e) => e.id))}
      >
        Open all
      </vscode-button>
      <vscode-button
        role="button"
        tabindex="0"
        class="part-button"
        secondary
        onclick={() => onCloseAll(exerciseGroup.exercises.map((e) => e.id))}
        onkeypress={() => onCloseAll(exerciseGroup.exercises.map((e) => e.id))}
      >
        Close all
      </vscode-button>
    </div>
  </div>
  <div>
    <div>
      Completed: {completedExercises} / {totalExercises}
    </div>
    <div>
      Downloaded: {downloadedExercises} / {totalExercises}
    </div>
    <div>
      Opened: {openedExercises} / {totalExercises}
    </div>
  </div>
  <br />
  <div>{exerciseGroup.nextDeadlineString}</div>
  <div class="show-exercises-container">
    <vscode-button
      role="button"
      tabindex="0"
      onclick={() => expanded.update((e) => !e)}
      onkeypress={() => expanded.update((e) => !e)}
      secondary
    >
      {#if $expanded}
        Hide exercises
      {:else}
        Show exercises
      {/if}
    </vscode-button>
  </div>
  <div>
    <div hidden={!$expanded}>
      <vscode-divider></vscode-divider>
      <div>
        <table class="exercise-table">
          <thead>
            <tr>
              <th class="exercise-table-header checkbox-header">
                <Checkbox
                  checked={allExercisesAreChecked}
                  onClick={(checked) => {
                    checkAllExercises(checked)
                  }}
                />
              </th>
              <th class="exercise-table-header">Exercise</th>
              <th class="exercise-table-header deadline-header">Deadline</th>
              <th class="exercise-table-header completed-header">Completed</th>
              <th class="exercise-table-header status-header">Status</th>
            </tr>
          </thead>
          <tbody>
            {#each exerciseGroup.exercises as exercise}
              <tr id={ExerciseIdentifier.toString(exercise.id)} class="exercise-row">
                <td class="exercise-table-cell">
                  <Checkbox
                    checked={isChecked(exercise.id)}
                    onClick={(checked) => {
                      setChecked([exercise.id], checked)
                    }}
                  />
                </td>
                <td class="exercise-table-cell"> {exercise.name}</td>
                <td class="exercise-table-cell">
                  {#if exercise.isHard}
                    {exercise.hardDeadlineString}
                  {:else}
                    <div>
                      {exercise.softDeadlineString}
                      <span title={getHardDeadlineInformation(exercise.hardDeadlineString)}>
                        ⓘ
                      </span>
                      <span class="codicon codicon-add"></span>
                    </div>
                  {/if}
                </td>
                {#if exercise.passed}
                  <td class="success-icon exercise-table-cell"> ✔ </td>
                {:else}
                  <td class="cross-icon exercise-table-cell"> ❌ </td>
                {/if}
                <td class="exercise-table-cell">
                  <vscode-badge>
                    {getStatus(exercise.id) ?? "Loading..."}
                  </vscode-badge>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  </div>
</Card>

<style>
  .part-header {
    display: flex;
    flex-direction: column;
    text-transform: capitalize;
  }
  .part-title {
    flex-grow: 1;
  }
  .part-buttons {
    display: flex;
    align-items: center;
    flex-direction: column;
  }
  .part-button {
    margin: 0.4rem;
    width: 90%;
    box-sizing: border-box;
  }
  .show-exercises-container {
    padding: 0.4rem;
    display: flex;
    justify-content: center;
  }
  .success-icon {
    font-size: 1.3rem;
  }
  .cross-icon {
    font-size: 0.7rem;
  }
  .exercise-row:nth-child(odd) {
    background-color: var(--vscode-editor-background, #1f1f1f);
    border-radius: 0.4rem;
    overflow: hidden;
  }
  .exercise-table-header {
    padding: 0.8rem;
    overflow: hidden;
    text-align: left;
  }
  .exercise-table-cell {
    padding: 0.8rem;
    word-wrap: break-word;
    overflow: hidden;
  }
  .exercise-table {
    width: 100%;
    table-layout: fixed;
    border-collapse: collapse;
  }
  .checkbox-header {
    width: 1rem;
  }
  .deadline-header {
    width: 20%;
  }
  .completed-header {
    width: 4rem;
  }
  .status-header {
    width: 4rem;
  }

  @media (min-width: 30rem) {
    .part-header {
      flex-direction: row;
    }
    .part-buttons {
      flex-direction: row;
    }
    .part-button {
      width: auto;
    }
    .exercise-table {
      border-collapse: collapse;
    }
  }
</style>
