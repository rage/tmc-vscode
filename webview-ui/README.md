# webview-ui

The Svelte app the extension renders inside its webviews. It owns no data: the
extension host decides what to show and supplies everything on it, and the app
posts the user's actions back. All communication is `postMessage` in both
directions — the webview cannot import extension code, and vice versa.

`src/shared/` re-exports the repository-root `shared/`, so both sides import the
same schemas from one file.

## Panels

A panel is one screen: `MyCourses`, `CourseDetails`, `ExerciseTests`, … Each has
a schema in `shared/protocol.ts` and a component of the same name in `src/panels/`.
The schemas form the `Panel` discriminated union, so adding a screen means
adding a variant there and a branch in `App.svelte`; `assertUnreachable` turns a
missing branch into a type error.

Every panel object carries an `id`. Two webviews (a main and a side panel) can
be open at once and the same panel type can appear in both, so the id is what
tells one instance's messages from another's.

`App.svelte` is mounted once and renders exactly one panel, chosen by
`appState.panel.type`. The `{#key appState.panel.id}` around it destroys and
recreates the component on navigation rather than reusing it, which is what
makes a panel's `onMount` request its data again.

Nothing in the webview survives a reload: VS Code discards the DOM whenever the
tab is hidden and restored. `App.svelte` therefore posts `ready` on startup, and
the extension host replies with the panel it last rendered plus the one-shot
messages it buffered for that panel — see `_messageBuffer` in
`src/panels/TmcPanel.ts`.

## About messages

`shared/protocol.ts` defines both directions as zod unions:
`ExtensionToWebviewSchema` and `WebviewToExtensionSchema`. Both are validated at
both ends. On the way out, `vscode.postMessage` (`src/utilities/vscode.ts`)
unwraps any `$state` proxies with `$state.snapshot`, so callers post state as is,
and refuses a message that does not parse. On the way in, one `window` listener
(`src/utilities/script.ts`) validates each message once and drops what does not
parse before handing it to the matching `addMessageListener` callbacks. The
message itself is passed on rather than zod's output, because parsing strips
fields the receiver needs.

A panel asks for its data in `onMount` and receives it through
`addMessageListener`:

```ts
const panelData = createPanelDataRequester()

let dataError = $state<WebviewError | undefined>(undefined)

async function requestData() {
  dataError = undefined
  dataError = await panelData.request((requestId) =>
    vscode.postMessage({
      type: "requestMyCoursesData",
      requestId,
      sourcePanel: panel,
    }),
  )
}

onMount(() => {
  void requestData()
})

addMessageListener(panel, (message) => {
  switch (message.type) {
    case "setMyCourses": {
      panel = { ...panel, courses: message.courses }
      break
    }
    case "panelDataResult": {
      panelData.answer(message)
      break
    }
    default:
      assertUnreachable(message)
  }
})
```

`addMessageListener` and `createPanelDataRequester` must both be called during
component initialization, like any other Svelte lifecycle function; they remove
their listener and clear their pending timers in `onDestroy`, so a recreated
component leaves nothing behind.

The host answers every `request*Data` message with one `panelDataResult` quoting
the request's `requestId`, whether or not it could assemble the data. A request
that goes unanswered — a crashed host, a dropped message, a handler that returns
without sending one — resolves as a timeout instead, so a panel shows why it has
no data rather than a spinner that never stops.

Which messages reach a listener is decided by the `target` on the message. A
target of `{type, id}` reaches only that instance — an exercise's test results
belong to the panel that started the run. A target of `{type}` alone is a
broadcast to every panel of that type, used for state more than one screen
shows, such as an exercise's status changing.

The `sourcePanel` a webview sends back is a strict `{id, type}`: passing a whole
panel object is rejected at the schema rather than failing later on the wire.

## Panel state

Props are not deeply reactive in Svelte 5, so an incoming message replaces the
panel rather than mutating it — `panel = { ...panel, courses }`, with
`let { panel = $bindable() }: Props = $props()`.

`ExerciseTests` and `ExerciseSubmission` are the exception. Their content is not
panel data but a running operation's output — progress lines, test results,
grading updates — which the extension host pushes as it goes. They keep it in
component-local `$state` and never reassign `panel`, so the panel prop stays the
identity the run was started with.

## Components

`src/components/` holds the pieces shared across panels. Anything resembling a
native VS Code control should come from `@vscode-elements/elements`, registered
once in `src/elements.ts` (imported by `main.ts` and by the test setup, so
component tests render the real elements) and typed for markup in
`src/vscode-elements.d.ts`. Use a `vscode-*` tag directly unless a component in
`src/components/` wraps it; a wrapper exists only where it adds behaviour, such
as `Button` stopping Space from scrolling or `Checkbox` naming its shadow input.

Styles use the `--tmc-*` tokens in `src/styles/tokens.css` rather than raw
`--vscode-*` names or literals; element defaults and utilities (`.muted`,
`.actions`, `.visually-hidden`, reduced motion) live in `src/styles/base.css`.

## Developing in a browser

`pnpm run harness` serves the app at <http://localhost:5199/> outside VS Code, with hot reload.
`dev/frame.html` stands in for the webview: it installs a fake `acquireVsCodeApi` whose host
(`dev/fakeHost.ts`) answers the app from a scenario in `dev/scenarios.ts`, then loads
`src/main.ts`. The page around it picks the scenario, the theme, a side-panel width and VS Code's
reduce-motion class, keeps them in the URL, and logs every message the app posts.

A scenario is a panel plus the host's replies to what that panel posts, and any messages pushed
after it mounts, as a test run's results are. Replies are validated against
`ExtensionToWebviewSchema`, so a scenario that drifts from the protocol throws instead of leaving
the panel silently waiting. Add a scenario for a state you want to look at; the accessibility
tests pick it up.

The themes are real: `dev/vscodeThemes.json` holds the `--vscode-*` variables VS Code gives a
webview under each default theme (Dark/Light Modern, Dark/Light 2026 and both High Contrast
themes), limited to the ones `src/` and `@vscode-elements/elements` read, along with the host
stylesheet every webview gets. `pnpm run themes:refresh [vscode-executable]` recaptures them from a
running VS Code, by default the newest one in `../.vscode-test`. Run it after using a
`--vscode-*` variable for the first time or when a VS Code release changes the default themes.
