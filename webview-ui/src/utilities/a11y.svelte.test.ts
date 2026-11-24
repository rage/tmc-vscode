import { screen } from "@testing-library/svelte"
import { flushSync } from "svelte"
import { vi } from "vitest"

import {
  announce,
  dismissKeepingFocus,
  focusOnMount,
  focusWhen,
  mountAnnouncer,
  reducedMotion,
} from "./a11y.svelte"

suite("announce", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  test("writes into one pre-mounted polite region", () => {
    const region = mountAnnouncer()
    expect(region).toHaveAttribute("role", "status")
    expect(region).toHaveAttribute("aria-live", "polite")
    expect(region).toBeEmptyDOMElement()

    announce("3 of 10 tests passed")
    vi.runAllTimers()

    expect(screen.getByRole("status")).toHaveTextContent("3 of 10 tests passed")
    expect(screen.getAllByTestId("announcer")).toHaveLength(1)
  })

  test("empties the region before a repeated message so it is read again", () => {
    announce("Course removed")
    vi.runAllTimers()
    announce("Course removed")

    expect(mountAnnouncer()).toBeEmptyDOMElement()
    vi.runAllTimers()
    expect(mountAnnouncer()).toHaveTextContent("Course removed")
  })

  test("keeps only the latest of messages sent in quick succession", () => {
    announce("Downloading")
    announce("Downloaded 3 exercises")
    vi.runAllTimers()
    expect(mountAnnouncer()).toHaveTextContent(/^Downloaded 3 exercises$/)
  })
})

function mountHeading(): HTMLElement {
  const element = document.createElement("h1")
  element.tabIndex = -1
  document.body.append(element)
  focusOnMount(element)
  return element
}

suite("focusOnMount", () => {
  afterEach(() => {
    document.querySelector("h1")?.remove()
    vi.restoreAllMocks()
  })

  test("focuses the element when the webview has focus", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true)
    const heading = mountHeading()
    expect(document.activeElement).toBe(heading)
  })

  test("leaves focus alone while the webview is in the background", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false)
    const heading = mountHeading()
    expect(document.activeElement).not.toBe(heading)
  })
})

suite("reducedMotion", () => {
  afterEach(() => {
    document.body.classList.remove("vscode-reduce-motion")
  })

  test("follows VS Code's reduce-motion body class", async () => {
    const observed: boolean[] = []
    const cleanup = $effect.root(() => {
      $effect(() => {
        observed.push(reducedMotion.current)
      })
    })
    flushSync()
    document.body.classList.add("vscode-reduce-motion")
    await vi.waitFor(() => expect(observed).toEqual([false, true]))
    cleanup()
  })
})

suite("dismissKeepingFocus", () => {
  test("moves focus to the next dismiss button, then to the heading", async () => {
    document.body.innerHTML = `<h1 tabindex="-1">Panel</h1>
      <div id="one"><button data-dismiss>a</button></div>
      <div id="two"><button data-dismiss>b</button></div>`
    const first = document.querySelector("#one button") as HTMLElement
    const second = document.querySelector("#two button") as HTMLElement
    first.focus()
    await dismissKeepingFocus(first, () => document.querySelector("#one")?.remove())
    expect(second).toHaveFocus()

    await dismissKeepingFocus(second, () => document.querySelector("#two")?.remove())
    expect(screen.getByRole("heading")).toHaveFocus()
  })
})

suite("focusWhen", () => {
  test("focuses once, unless focus is already somewhere", async () => {
    document.body.innerHTML = "<button id='x'>x</button><button id='y'>y</button>"
    const x = document.querySelector("#x") as HTMLElement
    const y = document.querySelector("#y") as HTMLElement
    const done = vi.fn()
    focusWhen(() => true, done)(x)
    await Promise.resolve()
    expect(x).toHaveFocus()
    expect(done).toHaveBeenCalledOnce()

    focusWhen(() => true, done)(y)
    await Promise.resolve()
    expect(x).toHaveFocus()
    expect(done).toHaveBeenCalledTimes(2)
  })

  test("leaves focus alone while it should not move", () => {
    document.body.innerHTML = "<button>x</button>"
    const button = document.querySelector("button") as HTMLElement
    const done = vi.fn()
    focusWhen(() => false, done)(button)
    expect(button).not.toHaveFocus()
    expect(done).not.toHaveBeenCalled()
  })
})
