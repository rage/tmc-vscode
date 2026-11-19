import { randomBytes } from "node:crypto"

/**
 * Generates a nonce for a single webview document's CSP `script-src`/`style-src`.
 *
 * @returns 32 base64url characters — 192 bits, safe unquoted in an HTML attribute and
 * in a CSP `'nonce-…'` source. Call it once per document: a nonce reused across
 * documents no longer bounds which scripts may run.
 */
export function getNonce(): string {
  return randomBytes(24).toString("base64url")
}
