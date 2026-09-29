import type { FrameControls } from "./frameControls"
import { POSTED_EVENT } from "./frameControls"
import { SCENARIOS } from "./scenarios"
import { applyTheme, VSCODE_THEMES, VSCODE_VERSION } from "./themes"

const form = document.querySelector("form") as HTMLFormElement
const frame = document.querySelector("iframe") as HTMLIFrameElement
const log = document.querySelector(".log ol") as HTMLOListElement
const controls = form.elements as HTMLFormControlsCollection & {
  scenario: HTMLSelectElement
  theme: HTMLSelectElement
  width: HTMLSelectElement
  reduceMotion: HTMLInputElement
  reload: HTMLButtonElement
}

controls.scenario.append(...SCENARIOS.map(({ id }) => new Option(id, id)))
controls.theme.append(
  ...VSCODE_THEMES.map(({ id }) => new Option(`${id} (VS Code ${VSCODE_VERSION})`, id)),
)

// The URL holds the settings, so a reload or a shared link opens the same view.
const initial = new URLSearchParams(location.search)
controls.scenario.value = initial.get("scenario") ?? SCENARIOS[0]?.id ?? ""
controls.theme.value = initial.get("theme") ?? VSCODE_THEMES[0]?.id ?? ""
controls.width.value = initial.get("width") ?? ""
controls.reduceMotion.checked = initial.get("reduceMotion") === "1"

function settings(): URLSearchParams {
  return new URLSearchParams({
    scenario: controls.scenario.value,
    theme: controls.theme.value,
    ...(controls.reduceMotion.checked ? { reduceMotion: "1" } : {}),
  })
}

function applySettingsToPage(): void {
  const theme = VSCODE_THEMES.find(({ id }) => id === controls.theme.value)
  if (theme) {
    applyTheme(document, theme)
  }
  frame.style.flex = controls.width.value ? `0 0 ${controls.width.value}px` : ""
  const url = settings()
  if (controls.width.value) {
    url.set("width", controls.width.value)
  }
  history.replaceState(null, "", `?${url}`)
}

function loadFrame(): void {
  log.replaceChildren()
  frame.src = `frame.html?${settings()}`
}

window.addEventListener(POSTED_EVENT, (event) => {
  const entry = document.createElement("li")
  entry.textContent = JSON.stringify((event as CustomEvent).detail, null, 1)
  log.append(entry)
})

form.addEventListener("change", (event) => {
  applySettingsToPage()
  if (event.target === controls.scenario) {
    loadFrame()
    return
  }
  // A theme change reaches an open webview live in VS Code too, without a reload.
  const frameControls = (frame.contentWindow as (Window & { tmcHarness?: FrameControls }) | null)
    ?.tmcHarness
  frameControls?.applyTheme(controls.theme.value, {
    isMotionReduced: controls.reduceMotion.checked,
  })
})
controls.reload.addEventListener("click", loadFrame)
document.querySelector<HTMLButtonElement>("[name=clearLog]")?.addEventListener("click", () => {
  log.replaceChildren()
})

applySettingsToPage()
loadFrame()
