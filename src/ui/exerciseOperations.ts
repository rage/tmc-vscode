import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import * as vscode from "vscode"

import { BottleneckError } from "../errors"
import { ExerciseIdentifier } from "../shared/shared"
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
 * The operations that refuse each other on one exercise. Everything in the submit lane
 * overwrites or reads the directory the others act on.
 */
const LANES: Record<ExerciseOperationKind, "download" | "test" | "submit"> = {
  downloading: "download",
  testing: "test",
  submitting: "submit",
  pasting: "submit",
  resetting: "submit",
  restoring: "submit",
}

const BUSY_MESSAGES: Record<(typeof LANES)[ExerciseOperationKind], string> = {
  download: "Some of these exercises are already downloading.",
  test: "Tests are already running for this exercise.",
  submit: "A submission for this exercise is already in progress.",
}

interface Claim {
  kind: ExerciseOperationKind
  backstop: ReturnType<typeof setTimeout>
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
 * Every such operation runs through here, which refuses one that conflicts with an
 * operation already running on the same exercise; the Courses view and the exercise status
 * bar item show what is running. Operations on no single exercise use `runSingleFlight`.
 */
export class ExerciseOperations {
  private readonly _running = new Map<string, Claim[]>()
  private readonly _changed = new vscode.EventEmitter<void>()

  /** Fires whenever an operation starts or ends. */
  public readonly onDidChange = this._changed.event

  public isRunning(exerciseId: ExerciseIdentifier, kind: ExerciseOperationKind): boolean {
    return (
      this._running.get(ExerciseIdentifier.key(exerciseId))?.some((claim) => claim.kind === kind) ??
      false
    )
  }

  /** The most recently started operation still running on `exerciseId`, if any. */
  public current(exerciseId: ExerciseIdentifier): ExerciseOperationKind | undefined {
    return this._running.get(ExerciseIdentifier.key(exerciseId))?.at(-1)?.kind
  }

  /**
   * Runs `work` as a `kind` operation on `exerciseId`, or returns a `BottleneckError` without
   * running it while a conflicting one runs.
   *
   * @param maxHoldMs Releases the claim after this long regardless, so a CLI call whose
   *   promise never settles cannot refuse the exercise's operations forever.
   */
  public async run<T>(
    exerciseId: ExerciseIdentifier,
    kind: ExerciseOperationKind,
    maxHoldMs: number,
    work: () => Promise<Result<T, Error>>,
  ): Promise<Result<T, Error>> {
    const claim = this.claim([exerciseId], kind, maxHoldMs)
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
   * a conflicting one running. The caller must release the claim; see {@link run}.
   */
  public claim(
    exerciseIds: readonly ExerciseIdentifier[],
    kind: ExerciseOperationKind,
    maxHoldMs: number,
  ): Result<ExerciseClaim, BottleneckError> {
    const lane = LANES[kind]
    const keys = [...new Set(exerciseIds.map((id) => ExerciseIdentifier.key(id)))]
    const conflicting = keys.find((key) =>
      this._running.get(key)?.some((claim) => LANES[claim.kind] === lane),
    )
    if (conflicting !== undefined) {
      Logger.warn(`Rejected ${kind} of exercise ${conflicting}, already in flight`)
      return Err(new BottleneckError(BUSY_MESSAGES[lane]))
    }
    const held = new Map<string, Claim>()
    const release = (key: string): void => {
      const claim = held.get(key)
      if (!claim) {
        return
      }
      held.delete(key)
      clearTimeout(claim.backstop)
      const claims = this._running.get(key)?.filter((other) => other !== claim) ?? []
      if (claims.length > 0) {
        this._running.set(key, claims)
      } else {
        this._running.delete(key)
      }
      this._changed.fire()
    }
    for (const key of keys) {
      const claim: Claim = { kind, backstop: setTimeout(() => release(key), maxHoldMs) }
      held.set(key, claim)
      this._running.set(key, [...(this._running.get(key) ?? []), claim])
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
