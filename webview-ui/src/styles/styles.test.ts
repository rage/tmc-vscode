import base from "./base.css?raw"
import tokens from "./tokens.css?raw"

suite("design tokens", () => {
  test("every VS Code size token has a px fallback for engines older than 1.137", () => {
    const sizeTokens = [
      ...tokens.matchAll(
        /var\(--vscode-(spacing|cornerRadius|fontSize|bodyFontSize)[^,)]*(,[^)]*)?\)/g,
      ),
    ]
    expect(sizeTokens.length).toBeGreaterThan(0)
    for (const [usage, , fallback] of sizeTokens) {
      expect(fallback, usage).toMatch(/^,\s*\d+px$/)
    }
  })

  test("status colours fall back to tokens that High Contrast themes define", () => {
    expect(tokens).toMatch(
      /--tmc-status-failed: var\(--vscode-testing-iconFailed, var\(--vscode-errorForeground\)\)/,
    )
    expect(tokens).toMatch(
      /--tmc-status-passed: var\(--vscode-testing-iconPassed, var\(--vscode-charts-green\)\)/,
    )
  })

  test("contains no raw colour literals", () => {
    expect(tokens.replaceAll(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i)
  })
})

suite("base styles", () => {
  test("honours VS Code's reduce-motion setting and the OS preference", () => {
    expect(base).toContain("body.vscode-reduce-motion *")
    expect(base).toContain("@media (prefers-reduced-motion: reduce)")
  })
})
