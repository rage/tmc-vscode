import type { VsCodeTheme } from "../../dev/themes"
import { CAPTURED_VARIABLE_NAMES, VSCODE_THEMES } from "../../dev/themes"

import tokens from "./tokens.css?raw"

// WCAG 2.2 SC 1.4.3 (text) and 1.4.11 (non-text: icons, meters, focus rings).
const TEXT = 4.5
const NON_TEXT = 3

interface Pairing {
  name: string
  foreground: string
  /** Painted over the page, which is the editor background: VS Code's webview body is transparent. */
  background?: string
  minimum: number
}

const PAGE = "var(--vscode-editor-background)"
// The host stylesheet's body colour, which every element without its own colour inherits.
const BODY_TEXT = "var(--vscode-editor-foreground)"

// Buttons use vscode-button's own declarations, fallbacks included.
const PAIRINGS: Pairing[] = [
  { name: "body text", foreground: BODY_TEXT, minimum: TEXT },
  { name: "--tmc-fg text", foreground: "var(--tmc-fg)", minimum: TEXT },
  { name: "muted text", foreground: "var(--tmc-fg-muted)", minimum: TEXT },
  { name: "link", foreground: "var(--tmc-fg-link)", minimum: TEXT },
  { name: "hovered link", foreground: "var(--tmc-fg-link-active)", minimum: TEXT },
  { name: "card text", foreground: BODY_TEXT, background: "var(--tmc-surface)", minimum: TEXT },
  {
    name: "muted card text",
    foreground: "var(--tmc-fg-muted)",
    background: "var(--tmc-surface)",
    minimum: TEXT,
  },
  {
    name: "code block text",
    foreground: BODY_TEXT,
    background: "var(--tmc-code-background)",
    minimum: TEXT,
  },
  {
    name: "section header text",
    foreground: "var(--tmc-section-header-foreground)",
    background: "var(--tmc-section-header-background)",
    minimum: TEXT,
  },
  {
    name: "section header description",
    foreground: "var(--tmc-fg-muted)",
    background: "var(--tmc-section-header-background)",
    minimum: TEXT,
  },
  ...(["error", "warning", "info"] as const).flatMap((kind) => [
    {
      name: `${kind} notice text`,
      foreground: BODY_TEXT,
      background: `var(--tmc-notice-${kind}-background)`,
      minimum: TEXT,
    },
    {
      name: `${kind} notice icon and accent`,
      foreground: `var(--tmc-fg-${kind})`,
      background: `var(--tmc-notice-${kind}-background)`,
      minimum: NON_TEXT,
    },
  ]),
  {
    name: "primary button label",
    foreground: "var(--vscode-button-foreground, #ffffff)",
    background: "var(--vscode-button-background, #0078d4)",
    minimum: TEXT,
  },
  {
    name: "secondary button label",
    foreground: "var(--vscode-button-secondaryForeground, #cccccc)",
    background: "var(--vscode-button-secondaryBackground, #313131)",
    minimum: TEXT,
  },
  ...(["passed", "failed", "unset", "warning"] as const).map((status) => ({
    name: `${status} status icon`,
    foreground: `var(--tmc-status-${status})`,
    minimum: NON_TEXT,
  })),
  { name: "info status icon", foreground: "var(--tmc-fg-info)", minimum: NON_TEXT },
  { name: "error status icon", foreground: "var(--tmc-fg-error)", minimum: NON_TEXT },
  { name: "muted status icon", foreground: "var(--tmc-fg-muted)", minimum: NON_TEXT },
  { name: "meter fill", foreground: "var(--tmc-meter-fill)", minimum: NON_TEXT },
  { name: "meter track outline", foreground: "var(--tmc-meter-track-border)", minimum: NON_TEXT },
  { name: "focus ring", foreground: "var(--tmc-focus-border)", minimum: NON_TEXT },
]

/** Colour tokens no pairing covers, and why none has to. */
const UNPAIRED_COLOUR_TOKENS: Record<string, string> = {
  "--tmc-fg-disabled": "inactive controls are exempt from SC 1.4.3",
  "--tmc-surface-border": "decorative; the surface is not the only cue for a card",
  "--tmc-overlay-border": "decorative",
  "--tmc-overlay-shadow": "decorative",
  "--tmc-hc-outline": "transparent outside High Contrast, where the theme picks it",
  "--tmc-hc-active-outline": "transparent outside High Contrast, where the theme picks it",
  "--tmc-section-header-border": "decorative",
}

/**
 * Pairings that fail today, keyed `"<pairing> in <theme>"`. Each is a product bug: fix the token
 * and delete the entry, and the test starts guarding it.
 */
const KNOWN_FAILURES: Record<string, string> = {
  ...inThemes(
    "meter track outline",
    ["Dark Modern", "Light Modern", "Dark 2026", "Light 2026"],
    "input.border is a faint hairline, so the meter's full extent is barely visible",
  ),
  ...inThemes(
    "passed status icon",
    ["Light Modern", "Light 2026"],
    "testing.iconPassed is #73c991 in light themes too",
  ),
  ...inThemes(
    "warning notice icon and accent",
    ["Light Modern", "Light 2026"],
    "editorWarning.foreground on inputValidation.warningBackground",
  ),
  "error notice icon and accent in Light Modern":
    "errorForeground on inputValidation.errorBackground",
  "muted card text in Dark 2026": "descriptionForeground on welcomePage.tileBackground",
  "meter fill in Default High Contrast": "button.background is the page colour, #000000",
}

function inThemes(pairing: string, themes: string[], reason: string): Record<string, string> {
  return Object.fromEntries(themes.map((theme) => [`${pairing} in ${theme}`, reason]))
}

const tokenDefinitions = new Map(
  [...tokens.replaceAll(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--tmc-[\w-]+):\s*([^;]+);/g)].map(
    ([, name, value]) => [name ?? "", (value ?? "").replaceAll(/\s+/g, " ").trim()],
  ),
)

/**
 * Evaluates a CSS value the way the cascade would under `theme`. Undefined means the value is
 * invalid at computed-value time: some `var()` on the way had neither a value nor a fallback.
 */
function resolveValue(value: string, theme: VsCodeTheme): string | undefined {
  const trimmed = value.trim()
  if (!trimmed.startsWith("var(")) {
    return trimmed
  }
  let depth = 0
  let comma = -1
  let end = -1
  for (let index = 4; index < trimmed.length; index++) {
    const character = trimmed[index]
    if (character === "(") {
      depth++
    } else if (character === ")") {
      if (depth === 0) {
        end = index
        break
      }
      depth--
    } else if (character === "," && depth === 0 && comma === -1) {
      comma = index
    }
  }
  if (end !== trimmed.length - 1) {
    throw new Error(`Cannot evaluate "${value}": only a single var() expression is supported`)
  }
  const name = trimmed.slice(4, comma === -1 ? end : comma).trim()
  const fallback = comma === -1 ? undefined : trimmed.slice(comma + 1, end)
  const resolved = resolveVariable(name, theme)
  if (resolved !== undefined) {
    return resolved
  }
  return fallback === undefined ? undefined : resolveValue(fallback, theme)
}

function resolveVariable(name: string, theme: VsCodeTheme): string | undefined {
  if (name.startsWith("--tmc-")) {
    const definition = tokenDefinitions.get(name)
    if (definition === undefined) {
      throw new Error(`${name} is not defined in tokens.css`)
    }
    return resolveValue(definition, theme)
  }
  if (!CAPTURED_VARIABLE_NAMES.includes(name)) {
    throw new Error(`${name} was not captured; run \`pnpm run themes:refresh\``)
  }
  return theme.variables[name]
}

type Rgba = [red: number, green: number, blue: number, alpha: number]

function parseColour(colour: string): Rgba {
  if (colour === "transparent") {
    return [0, 0, 0, 0]
  }
  const hex = /^#([0-9a-f]{3,8})$/i.exec(colour)?.[1]
  if (hex !== undefined) {
    const digits =
      hex.length <= 4
        ? [...hex].map((digit) => digit + digit)
        : (hex.match(/../g) ?? []).map(String)
    const [red = 0, green = 0, blue = 0, alpha = 255] = digits.map((pair) =>
      Number.parseInt(pair, 16),
    )
    return [red, green, blue, alpha / 255]
  }
  const functional = /^rgba?\(([^)]+)\)$/.exec(colour)?.[1]
  if (functional !== undefined) {
    const [red = 0, green = 0, blue = 0, alpha = 1] = functional
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(Number)
    return [red, green, blue, alpha]
  }
  throw new Error(`Unsupported colour "${colour}"`)
}

function composite(top: Rgba, bottom: Rgba): Rgba {
  const alpha = top[3] + bottom[3] * (1 - top[3])
  if (alpha === 0) {
    return [0, 0, 0, 0]
  }
  const channel = (index: 0 | 1 | 2): number =>
    (top[index] * top[3] + bottom[index] * bottom[3] * (1 - top[3])) / alpha
  return [channel(0), channel(1), channel(2), alpha]
}

function linearChannel(channel: number): number {
  const srgb = channel / 255
  return srgb <= 0.040_45 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
}

function relativeLuminance([red, green, blue]: Rgba): number {
  return 0.2126 * linearChannel(red) + 0.7152 * linearChannel(green) + 0.0722 * linearChannel(blue)
}

function contrastRatio(foreground: Rgba, background: Rgba): number {
  const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)].toSorted(
    (a, b) => b - a,
  )
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05)
}

function resolveColour(value: string, theme: VsCodeTheme, what: string): Rgba {
  const resolved = resolveValue(value, theme)
  if (resolved === undefined) {
    throw new Error(`${what} (${value}) resolves to nothing in ${theme.id}`)
  }
  return parseColour(resolved === "inherit" ? (resolveValue(BODY_TEXT, theme) ?? "") : resolved)
}

/** The contrast `pairing` renders with under `theme`, both colours flattened onto the page. */
function pairingContrast(pairing: Pairing, theme: VsCodeTheme): number {
  const page = resolveColour(PAGE, theme, "page background")
  const background = pairing.background
    ? composite(resolveColour(pairing.background, theme, "background"), page)
    : page
  const foreground = composite(resolveColour(pairing.foreground, theme, "foreground"), background)
  return contrastRatio(foreground, background)
}

suite("theme contrast", () => {
  test("covers the six default themes", () => {
    expect(VSCODE_THEMES.map((theme) => theme.kind).toSorted()).toEqual([
      "vscode-dark",
      "vscode-dark",
      "vscode-high-contrast",
      "vscode-high-contrast-light",
      "vscode-light",
      "vscode-light",
    ])
  })

  test("every colour token is paired or says why it need not be", () => {
    const paired = PAIRINGS.flatMap(({ foreground, background }) =>
      [foreground, background ?? ""].flatMap((value) =>
        [...value.matchAll(/--tmc-[\w-]+/g)].map(([name]) => name),
      ),
    )
    const colourTokens = [...tokenDefinitions.keys()].filter(
      (name) => !/^--tmc-(space|radius|font)/.test(name),
    )
    const unaccounted = colourTokens.filter(
      (name) => !paired.includes(name) && !(name in UNPAIRED_COLOUR_TOKENS),
    )
    expect(unaccounted).toEqual([])
  })

  test("every known failure names a pairing and a theme", () => {
    const caseNames = VSCODE_THEMES.flatMap((theme) =>
      PAIRINGS.map((pairing) => `${pairing.name} in ${theme.id}`),
    )
    expect(Object.keys(KNOWN_FAILURES).filter((name) => !caseNames.includes(name))).toEqual([])
  })

  for (const theme of VSCODE_THEMES) {
    suite(theme.id, () => {
      for (const pairing of PAIRINGS) {
        const caseName = `${pairing.name} in ${theme.id}`
        const knownFailure = KNOWN_FAILURES[caseName]
        const title = `${pairing.name} reaches ${pairing.minimum}:1`
        const run = knownFailure === undefined ? test : test.fails
        run(knownFailure === undefined ? title : `${title} (known bug: ${knownFailure})`, () => {
          expect(pairingContrast(pairing, theme)).toBeGreaterThanOrEqual(pairing.minimum)
        })
      }
    })
  }
})

suite("contrast arithmetic", () => {
  test("matches the WCAG reference values", () => {
    expect(contrastRatio(parseColour("#000000"), parseColour("#ffffff"))).toBeCloseTo(21, 5)
    expect(contrastRatio(parseColour("#767676"), parseColour("#ffffff"))).toBeCloseTo(4.54, 2)
  })

  test("flattens a translucent colour onto what is under it", () => {
    expect(composite(parseColour("rgba(0, 0, 0, 0.5)"), parseColour("#ffffff"))).toEqual([
      127.5, 127.5, 127.5, 1,
    ])
    expect(parseColour("#ff000080")[3]).toBeCloseTo(0.5, 2)
  })

  test("takes a var() fallback only when the variable is unset", () => {
    const theme: VsCodeTheme = {
      id: "test",
      kind: "vscode-dark",
      variables: { "--vscode-foreground": "#111111" },
    }
    expect(resolveValue("var(--vscode-foreground, #222222)", theme)).toBe("#111111")
    expect(resolveValue("var(--vscode-errorForeground, var(--vscode-foreground))", theme)).toBe(
      "#111111",
    )
    expect(resolveValue("var(--vscode-errorForeground)", theme)).toBeUndefined()
  })
})
