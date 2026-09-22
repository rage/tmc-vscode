// The contract shared between the extension host and the webview, re-exported as one
// module: `enum` (the backend-tagged union and the identifiers built on it), `course`
// (course and exercise data), `protocol` (panels and the messages crossing between the
// two sides) and `errors`.
//
// Every runtime-validated type is a zod schema with its TypeScript type inferred from it,
// so the schema is the single source of truth on both sides of the message boundary.
export * from "./course"
export * from "./enum"
export * from "./errors"
export * from "./protocol"
