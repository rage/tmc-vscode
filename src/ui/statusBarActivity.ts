import * as vscode from "vscode"

/** What is running against an exercise, as the exercise status bar item names it. */
export type ExerciseActivityKind = "testing" | "submitting"

/**
 * The test runs and submissions in flight, per exercise folder.
 *
 * Whatever starts one wraps its work in {@link run}; the exercise status bar item listens
 * to {@link onDidChange}. Keyed by the exercise folder's uri, so a run started from any
 * file of the exercise shows on all of them.
 */
export interface ExerciseActivity {
  /** The most recently started activity still running on `exerciseUri`, if any. */
  current: (exerciseUri: vscode.Uri) => ExerciseActivityKind | undefined
  /** Marks `kind` as running on `exerciseUri` until `work` settles, and returns its result. */
  run: <T>(
    exerciseUri: vscode.Uri,
    kind: ExerciseActivityKind,
    work: () => Promise<T>,
  ) => Promise<T>
  onDidChange: vscode.Event<void>
}

/** Builds an empty {@link ExerciseActivity}; activation uses the shared {@link exerciseActivity}. */
export function createExerciseActivity(): ExerciseActivity {
  const running = new Map<string, ExerciseActivityKind[]>()
  const changed = new vscode.EventEmitter<void>()

  return {
    current(exerciseUri) {
      return running.get(exerciseUri.toString())?.at(-1)
    },
    async run(exerciseUri, kind, work) {
      const key = exerciseUri.toString()
      const kinds = running.get(key) ?? []
      kinds.push(kind)
      running.set(key, kinds)
      changed.fire()
      try {
        return await work()
      } finally {
        kinds.splice(kinds.lastIndexOf(kind), 1)
        if (kinds.length === 0) {
          running.delete(key)
        }
        changed.fire()
      }
    },
    onDidChange: changed.event,
  }
}

/** The one tracker the commands report to and the status bar reads. */
export const exerciseActivity: ExerciseActivity = createExerciseActivity()
