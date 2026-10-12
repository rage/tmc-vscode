import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import * as vscode from "vscode"

import { ExerciseIdentifier } from "../../shared/lib"
import { BottleneckError } from "../errors"
import { Logger } from "../utilities/logger"

/** What can run against one exercise. */
export type ExerciseOperationKind =
  | "downloading"
  | "testing"
  | "submitting"
  | "pasting"
  | "resetting"
  | "restoring"

/**
 * What refusing an operation tells the user, by the operation already running. Any two
 * operations on one exercise conflict: each writes the exercise's directory (a test run its
 * build output) or submits what is in it.
 */
const BUSY_MESSAGES: Record<ExerciseOperationKind, string> = {
  downloading: "Some of these exercises are already downloading.",
  testing: "Tests are already running for this exercise.",
  submitting: "A submission for this exercise is already in progress.",
  pasting: "A submission for this exercise is already in progress.",
  resetting: "This exercise is being reset.",
  restoring: "An old submission is being restored into this exercise.",
}

interface Claim {
  kind: ExerciseOperationKind
}

/** A held claim on several exercises, released one at a time as each one's part finishes. */
export interface ExerciseClaim {
  /** Releases `exerciseId`'s part; releasing one twice, or one never claimed, does nothing. */
  release: (exerciseId: ExerciseIdentifier) => void
  releaseAll: () => void
}

/**
 * The downloads, test runs and submissions in flight, per exercise.
 *
 * Every such operation runs through here, which refuses one while another runs on the same
 * exercise; the Courses view and the exercise status bar item show what is running.
 */
export class ExerciseOperations {
  private readonly _running = new Map<string, Claim>()
  private readonly _changed = new vscode.EventEmitter<void>()

  /** Fires whenever an operation starts or ends. */
  public readonly onDidChange = this._changed.event

  public isRunning(exerciseId: ExerciseIdentifier, kind: ExerciseOperationKind): boolean {
    return this.current(exerciseId) === kind
  }

  /** The operation running on `exerciseId`, if any. */
  public current(exerciseId: ExerciseIdentifier): ExerciseOperationKind | undefined {
    return this._running.get(ExerciseIdentifier.key(exerciseId))?.kind
  }

  /**
   * Runs `work` as a `kind` operation on `exerciseId`, or returns a `BottleneckError` without
   * running it while another operation runs on that exercise. The claim lasts until `work`
   * settles, which every CLI call does once its process ends or is killed.
   */
  public async run<T>(
    exerciseId: ExerciseIdentifier,
    kind: ExerciseOperationKind,
    work: () => Promise<Result<T, Error>>,
  ): Promise<Result<T, Error>> {
    const claim = this.claim([exerciseId], kind)
    if (claim.err) {
      return claim
    }
    try {
      return await work()
    } finally {
      claim.val.releaseAll()
    }
  }

  /**
   * Claims every one of `exerciseIds` for a `kind` operation, or none of them while any has
   * an operation running. The caller must release the claim; see {@link run}.
   */
  public claim(
    exerciseIds: readonly ExerciseIdentifier[],
    kind: ExerciseOperationKind,
  ): Result<ExerciseClaim, BottleneckError> {
    const keys = [...new Set(exerciseIds.map((id) => ExerciseIdentifier.key(id)))]
    const conflicting = keys.find((key) => this._running.has(key))
    if (conflicting !== undefined) {
      const running = this._running.get(conflicting)?.kind ?? kind
      Logger.warn(`Rejected ${kind} of exercise ${conflicting}, already ${running}`)
      return Err(new BottleneckError(BUSY_MESSAGES[running]))
    }
    const held = new Map<string, Claim>()
    const release = (key: string): void => {
      const claim = held.get(key)
      if (!claim) {
        return
      }
      held.delete(key)
      if (this._running.get(key) === claim) {
        this._running.delete(key)
      }
      this._changed.fire()
    }
    for (const key of keys) {
      const claim: Claim = { kind }
      held.set(key, claim)
      this._running.set(key, claim)
    }
    this._changed.fire()
    return Ok({
      release: (exerciseId) => release(ExerciseIdentifier.key(exerciseId)),
      releaseAll: () => [...held.keys()].forEach((key) => release(key)),
    })
  }
}

/** The one registry every exercise operation claims through. */
export const exerciseOperations = new ExerciseOperations()
