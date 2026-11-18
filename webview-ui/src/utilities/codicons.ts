const CODICON_STYLESHEET_ID = "vscode-codicon-stylesheet"

/**
 * Serves the codicon rules that every `<vscode-icon>` links into its shadow root from memory.
 *
 * Each such link is a request through VS Code's service worker; one still pending when VS Code
 * discards a hidden webview stalls the next webview's reveal for ~30 s. A `blob:` URL bypasses it.
 *
 * Call before the first icon renders. Does nothing when the stylesheet's rules cannot be read.
 */
export function serveCodiconsFromMemory(): void {
  const loaded = document.querySelector(`#${CODICON_STYLESHEET_ID}`)
  if (!(loaded instanceof HTMLLinkElement) || !loaded.sheet) {
    return
  }
  let rules: string
  try {
    rules = Array.from(loaded.sheet.cssRules)
      // A font declared in a shadow root is ignored; the page's own declaration serves it.
      .filter((rule) => !(rule instanceof CSSFontFaceRule))
      .map((rule) => rule.cssText)
      .join("\n")
  } catch {
    return
  }
  const inMemory = document.createElement("link")
  inMemory.rel = "stylesheet"
  const nonce = loaded.nonce ?? ""
  inMemory.nonce = nonce
  inMemory.setAttribute("nonce", nonce)
  inMemory.href = URL.createObjectURL(new Blob([rules], { type: "text/css" }))
  loaded.removeAttribute("id")
  inMemory.id = CODICON_STYLESHEET_ID
  document.head.append(inMemory)
}
