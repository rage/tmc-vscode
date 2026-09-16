// The host's error contract, transcribed from secret-project-331's
// `server/src/domain/error.rs`.
//
// Every `ControllerErrorType` variant fixes three things at once: the envelope's
// `type`, its `message_key` and the HTTP status. The message keys are unique
// across variants, so naming the key determines the other two -- which is why
// this table is keyed by it and why a handler here names only a key.
//
// Transcribed rather than validated against, because the vendored spec cannot
// stand in for it: `components.schemas.ApiErrorResponse` declares no `required`
// members, every member nullable and no `additionalProperties: false`, so the
// mock's response validation accepts `{}` for every documented 4xx. Keep this in
// step with `error.rs`; nothing detects the drift automatically.
//
// `ControllerErrorType::OAuthError` is deliberately absent: it answers with the
// RFC 6749 `{error, error_description}` body instead of this envelope, and that
// contract lives in ./oauth.ts.

interface ApiErrorContract {
  /** The envelope's `type`, shared by every key of the same variant group. */
  type: string
  status: number
}

export const API_ERRORS = {
  internal_error: { type: "internal_error", status: 500 },
  validation_error: { type: "validation_error", status: 422 },
  validation_error_with_metadata: { type: "validation_error", status: 422 },
  course_slug_already_taken: { type: "validation_error", status: 422 },
  foreign_key_violation: { type: "validation_error", status: 422 },
  not_enrolled: { type: "validation_error", status: 422 },
  upload_expired: { type: "validation_error", status: 422 },
  unknown_upload: { type: "validation_error", status: 422 },
  duplicate_upload: { type: "validation_error", status: 422 },
  obsolete_client: { type: "obsolete_client", status: 426 },
  not_found: { type: "not_found", status: 404 },
  unauthorized: { type: "unauthorized", status: 401 },
  chapter_not_open_yet: { type: "unauthorized", status: 401 },
  authentication_required_for_exam_exercise: { type: "unauthorized", status: 401 },
  forbidden: { type: "forbidden", status: 403 },
  invalid_course_code: { type: "sisu_error", status: 400 },
  generic_sisu_error: { type: "sisu_error", status: 502 },
  sisu_resource_not_found: { type: "sisu_error", status: 404 },
} as const satisfies Record<string, ApiErrorContract>

export type ApiErrorMessageKey = keyof typeof API_ERRORS
