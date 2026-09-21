# webview-ui

The Svelte app the extension renders inside its webviews. It owns no data: the
extension host decides what to show and supplies everything on it, and the app
posts the user's actions back. All communication is `postMessage` in both
directions — the webview cannot import extension code, and vice versa.

`src/shared/` is a set of symlinks into the repository-root `shared/`, so both
sides import the same schemas from one file.

## Panels

A panel is one screen: `MyCourses`, `CourseDetails`, `ExerciseTests`, … Each has
a schema in `shared/lib.ts` and a component of the same name in `src/panels/`.
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

`shared/lib.ts` defines both directions as zod unions:
`ExtensionToWebviewSchema` and `WebviewToExtensionSchema`. Both are validated at
both ends. On the way out, `vscode.postMessage` (`src/utilities/vscode.ts`)
refuses to post a message that does not parse — otherwise a Svelte `$state`
proxy would fail structured clone with an opaque `DataCloneError`. On the way
in, `addMessageListener` (`src/utilities/script.ts`) drops what does not parse.
The original object is passed on rather than zod's output, because parsing
strips fields the receiver needs.

A panel asks for its data in `onMount` and receives it through
`addMessageListener`:

```ts
onMount(() => {
  vscode.postMessage({
    type: "requestMyCoursesData",
    // `panel` is a `$state` proxy once a message has reassigned it
    sourcePanel: $state.snapshot(panel),
  })
})

addMessageListener(panel, (message) => {
  switch (message.type) {
    case "setMyCourses": {
      panel = { ...panel, courses: message.courses }
      break
    }
    default:
      assertUnreachable(message)
  }
})
```

`addMessageListener` must be called during component initialization, like any
other Svelte lifecycle function; it removes its `window` listener in `onDestroy`
so a recreated component does not leave a stale one behind.

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
`let { panel = $bindable() }: Props = $props()`. `App.svelte` holds its own
state as `$state.raw` for the same reason the snapshot above exists: a deep
proxy cannot be posted.

`ExerciseTests` and `ExerciseSubmission` are the exception. Their content is not
panel data but a running operation's output — progress lines, test results,
grading updates — which the extension host pushes as it goes. They keep it in
component-local `$state` and never reassign `panel`, so the panel prop stays the
identity the run was started with.

## Components

`src/components/` holds the pieces shared across panels. Anything resembling a
native VS Code control should come from `@vscode-elements/elements`, registered
by the side-effect imports at the top of `App.svelte`.
