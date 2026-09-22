import { z } from "zod"

import {
  zCliOutput,
  zCourseProgress,
  zMoocOldSubmissionRestore,
  zNotification,
  zOutputData,
  zStatusUpdateData,
} from "./generated/langs/zod.gen"

// The tmc-langs-cli stdout contract, as zod v4 schemas.
//
// Source of truth: the serde-annotated Rust types in tmc-langs-rust, exported
// from that repo as a schemars JSON Schema generated with the *serialize*
// contract, so it describes exactly what the CLI writes to stdout. The vendored
// copy is shared/bindings.schema.json and the rev it came from is recorded in
// shared/bindings.schema.source.json.
//
// One public alias per contract schema is generated into shared/generated/langs
// and re-exported below, so a new CLI type reaches consumers without anyone
// editing this file. Regenerate with `pnpm run vendor:langs-schema` (re-vendors
// the JSON Schema) followed by `pnpm run generate:langs-schema`. What stays
// hand-written here is only what carries a decision the contract does not; the
// generator refuses to emit an alias that would shadow one of them.
//
// Two properties of the generated schemas are easy to trip over:
//   - Optionality reflects *serialization*: serde emits Option::None as an
//     explicit `null` unless skip_serializing_if is set, so Option fields are
//     required-but-nullable and only genuinely omitted fields are optional.
//   - `format: "date-time"` is stripped during generation, so timestamps
//     validate as plain strings: real TMC timestamps carry +03:00 offsets that
//     a Z-only ISO check would reject.
//
// Objects are non-strict, so a newer CLI adding fields does not break
// validation.
export * from "./generated/langs"

// ---------------------------------------------------------------------------
// Not part of the generated CliOutput contract: CLI input helpers and
// client-side composites, kept hand-written for compatibility.
// ---------------------------------------------------------------------------

export const Locale = z.string()
export type Locale = z.infer<typeof Locale>

export const Compression = z.enum(["tar", "zip", "zstd"])
export type Compression = z.infer<typeof Compression>

/**
 * The answers a user gave to a submission's feedback questions.
 *
 * `tmc send-feedback` takes them as repeated `--feedback <question-id> <answer>` pairs;
 * this is the shape a caller assembles before that flattening.
 */
export interface SubmissionFeedback {
  status: SubmissionFeedbackAnswer[]
}

export interface SubmissionFeedbackAnswer {
  question_id: number
  answer: string
}

/** The format for all status updates. May contain some data. */
export interface StatusUpdate<T> {
  finished: boolean
  message: string
  "percent-done": number
  time: number
  data: T | null
}

/**
 * The released CLI that `TMC_LANGS_RUST_VERSION` pins reports a partially failed
 * tmc batch download as a structured `{ "failed-exercise-download": ... }` error
 * kind. The current CLI reports that case as a plain `generic` error, so the
 * variant is absent from the generated contract — but the pinned binary is the
 * one shipped to users, and its error output must still validate. Nothing here
 * consumes the structured form (the human-readable `message` carries the
 * detail), so fold it into `generic` rather than carrying a second output shape
 * through every type that intersects `OutputData`.
 */
function normalizeReleasedErrorKind(output: unknown): unknown {
  if (
    output === null ||
    typeof output !== "object" ||
    (output as { "output-kind"?: unknown })["output-kind"] !== "output-data"
  ) {
    return output
  }
  const data = (output as { data?: unknown }).data
  if (
    data === null ||
    typeof data !== "object" ||
    (data as { "output-data-kind"?: unknown })["output-data-kind"] !== "error"
  ) {
    return output
  }
  const errorData = (data as { "output-data"?: unknown })["output-data"]
  if (errorData === null || typeof errorData !== "object") {
    return output
  }
  const kind = (errorData as { kind?: unknown }).kind
  if (
    kind === null ||
    typeof kind !== "object" ||
    !("failed-exercise-download" in (kind as object))
  ) {
    return output
  }
  return {
    ...output,
    data: { ...data, "output-data": { ...errorData, kind: "generic" } },
  }
}

export const CliOutput = z.preprocess(normalizeReleasedErrorKind, zCliOutput)
export type CliOutput = z.infer<typeof CliOutput>

/**
 * A `notification` line: `CliOutput`'s third branch on its own.
 *
 * Exported so a decoder can pick the branch the line's `output-kind` names instead of
 * measuring every line against all three; `CliOutput` leads with the `output-data` branch,
 * whose payload union has 44 members.
 */
export const CliNotification = z.preprocess(
  normalizeReleasedErrorKind,
  zNotification.and(z.object({ "output-kind": z.literal("notification") })),
)
export type CliNotification = z.infer<typeof CliNotification>

/** An `output-data` line: `CliOutput`'s first branch on its own. See {@link CliNotification}. */
export const CliOutputData = z.preprocess(
  normalizeReleasedErrorKind,
  zOutputData.and(z.object({ "output-kind": z.literal("output-data") })),
)
export type CliOutputData = z.infer<typeof CliOutputData>

/** A `status-update` line: `CliOutput`'s second branch on its own. See {@link CliNotification}. */
export const CliStatusUpdate = z.preprocess(
  normalizeReleasedErrorKind,
  zStatusUpdateData.and(z.object({ "output-kind": z.literal("status-update") })),
)
export type CliStatusUpdate = z.infer<typeof CliStatusUpdate>

/** Per-exercise progress for a course, from `mooc course-progress` (`mooc-course-progress` output kind); course totals are derived by summation. */
export const MoocCourseProgress = zCourseProgress
export type MoocCourseProgress = z.infer<typeof MoocCourseProgress>

/** Outcome of `mooc download-old-submission`: `nothing-to-download` for a submission the server has no files for, which only an exercise type with no files at all can be. */
export const MoocOldSubmissionRestore = zMoocOldSubmissionRestore
export type MoocOldSubmissionRestore = z.infer<typeof MoocOldSubmissionRestore>
