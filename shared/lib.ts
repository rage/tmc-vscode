// The contract shared between the extension host and the webview, re-exported as one
// module: `enum` (the backend-tagged union and the identifiers built on it), `course`
// (course and exercise data), `courseHome` (what the course home shows), `protocol` (panels
// and the messages crossing between the two sides), `errors`, and `withDistinctKeys` for
// keying lists whose names may repeat.
//
// Every runtime-validated type is a zod schema with its TypeScript type inferred from it,
// so the schema is the single source of truth on both sides of the message boundary.
export * from "./course"
export * from "./courseHome"
export * from "./enum"
export * from "./errors"
export * from "./protocol"
export * from "./withDistinctKeys"
