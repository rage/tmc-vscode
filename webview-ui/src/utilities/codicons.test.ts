import { vi } from "vitest"

import { serveCodiconsFromMemory } from "./codicons"

const ID = "vscode-codicon-stylesheet"

suite("serveCodiconsFromMemory", () => {
  let loaded: HTMLLinkElement

  beforeEach(() => {
    loaded = document.querySelector(`#${ID}`) as HTMLLinkElement
    loaded.nonce = "abc"
  })

  afterEach(() => {
    document.querySelectorAll(`link[href^="blob:"]`).forEach((link) => link.remove())
    loaded.id = ID
    Reflect.deleteProperty(loaded, "sheet")
    vi.restoreAllMocks()
  })

  function givenRules(...rules: CSSRule[]): void {
    Object.defineProperty(loaded, "sheet", { configurable: true, value: { cssRules: rules } })
  }

  test("points the icons at an in-memory copy of the rules, without the font", async () => {
    const fontFace = Object.create(CSSFontFaceRule.prototype, {
      cssText: { value: "@font-face { font-family: codicon }" },
    }) as CSSRule
    givenRules(fontFace, { cssText: ".codicon-add::before { content: 'a' }" } as CSSRule)
    let served: Blob | undefined
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      served = blob as Blob
      return "blob:codicons"
    })

    serveCodiconsFromMemory()

    const named = document.querySelector(`#${ID}`) as HTMLLinkElement
    expect(named).not.toBe(loaded)
    expect(named.getAttribute("href")).toBe("blob:codicons")
    expect(named.nonce).toBe("abc")
    expect(await served?.text()).toBe(".codicon-add::before { content: 'a' }")
  })

  test("leaves the stylesheet in place when its rules cannot be read", () => {
    Object.defineProperty(loaded, "sheet", {
      configurable: true,
      value: {
        get cssRules(): never {
          throw new DOMException("cross-origin", "SecurityError")
        },
      },
    })

    serveCodiconsFromMemory()

    expect(document.querySelector(`#${ID}`)).toBe(loaded)
  })
})
