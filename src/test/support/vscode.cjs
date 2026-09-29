// CommonJS so Vite's interop exposes the mock's members as named exports for
// `import * as vscode from "vscode"`. `vi` is available as a global (globals: true).
const { createVSCodeMock } = require("jest-mock-vscode")

const vscode = createVSCodeMock(vi)

// jest-mock-vscode does not ship every value-class the extension constructs at
// module load. Fill the gaps the extension host relies on.
if (typeof vscode.FileDecoration !== "function") {
  // oxlint-disable-next-line typescript/no-extraneous-class -- mirrors the vscode.FileDecoration constructor shape
  vscode.FileDecoration = class FileDecoration {
    constructor(badge, tooltip, color) {
      this.badge = badge
      this.tooltip = tooltip
      this.color = color
      this.propagate = false
    }
  }
}

if (vscode.QuickPickItemKind === undefined) {
  vscode.QuickPickItemKind = { Separator: -1, Default: 0 }
}
if (vscode.QuickInputButtons === undefined) {
  vscode.QuickInputButtons = { Back: { iconPath: new vscode.ThemeIcon("arrow-left") } }
}

// jest-mock-vscode's `createDiagnosticCollection` returns nothing. This one keeps what is set
// on it, keyed like the real one by the uri's string form.
vscode.languages.createDiagnosticCollection = vi.fn((name = "") => {
  const entries = new Map()
  const collection = {
    name,
    set: (uri, diagnostics) => {
      if (diagnostics === undefined) {
        entries.delete(uri.toString())
      } else {
        entries.set(uri.toString(), { uri, diagnostics })
      }
    },
    delete: (uri) => void entries.delete(uri.toString()),
    clear: () => entries.clear(),
    get: (uri) => entries.get(uri.toString())?.diagnostics,
    has: (uri) => entries.has(uri.toString()),
    forEach: (callback) => {
      for (const { uri, diagnostics } of entries.values()) {
        callback(uri, diagnostics, collection)
      }
    },
    dispose: () => entries.clear(),
    *[Symbol.iterator]() {
      for (const { uri, diagnostics } of entries.values()) {
        yield [uri, diagnostics]
      }
    },
  }
  return collection
})

if (typeof vscode.CancellationTokenSource !== "function") {
  vscode.CancellationTokenSource = class CancellationTokenSource {
    constructor() {
      const emitter = new vscode.EventEmitter()
      this._emitter = emitter
      this.token = {
        isCancellationRequested: false,
        onCancellationRequested: (listener) => emitter.event(listener),
      }
    }
    cancel() {
      if (!this.token.isCancellationRequested) {
        this.token.isCancellationRequested = true
        this._emitter.fire(undefined)
      }
    }
    dispose() {
      this._emitter.dispose()
    }
  }
}

// jest-mock-vscode leaves out the Testing API. This one records what a run reports in
// `run.results`, as `[state, itemId, message?]`, and what it prints in `run.output`.
vscode.TestRunProfileKind = { Run: 1, Debug: 2, Coverage: 3 }
vscode.TestMessage = class TestMessage {
  constructor(message) {
    this.message = message
  }
  static diff(message, expected, actual) {
    const diff = new TestMessage(message)
    diff.expectedOutput = expected
    diff.actualOutput = actual
    return diff
  }
}
// oxlint-disable-next-line typescript/no-extraneous-class -- mirrors the vscode.TestMessageStackFrame constructor shape
vscode.TestMessageStackFrame = class TestMessageStackFrame {
  constructor(label, uri, position) {
    this.label = label
    this.uri = uri
    this.position = position
  }
}
// oxlint-disable-next-line typescript/no-extraneous-class -- mirrors the vscode.TestRunRequest constructor shape
vscode.TestRunRequest = class TestRunRequest {
  constructor(include, exclude, profile, continuous = false, preserveFocus = true) {
    this.include = include
    this.exclude = exclude
    this.profile = profile
    this.continuous = continuous
    this.preserveFocus = preserveFocus
  }
}

function createTestItemCollection(owner) {
  const items = new Map()
  const collection = {
    get size() {
      return items.size
    },
    get: (id) => items.get(id),
    add: (item) => {
      item.parent = owner
      items.set(item.id, item)
    },
    delete: (id) => void items.delete(id),
    replace: (replacements) => {
      items.clear()
      for (const item of replacements) {
        collection.add(item)
      }
    },
    forEach: (callback) => {
      for (const item of items.values()) {
        callback(item, collection)
      }
    },
    *[Symbol.iterator]() {
      for (const item of items.values()) {
        yield [item.id, item]
      }
    },
  }
  return collection
}

function createTestController(id, label) {
  const controller = {
    id,
    label,
    items: createTestItemCollection(undefined),
    profiles: [],
    runs: [],
    createTestItem: (itemId, itemLabel, uri) => {
      const item = { id: itemId, label: itemLabel, uri, parent: undefined, tags: [] }
      item.children = createTestItemCollection(item)
      return item
    },
    createRunProfile: (profileLabel, kind, runHandler, isDefault = false) => {
      const profile = { label: profileLabel, kind, runHandler, isDefault, dispose: vi.fn() }
      controller.profiles.push(profile)
      return profile
    },
    createTestRun: (request, name, persist = true) => {
      const cancellation = new vscode.CancellationTokenSource()
      const results = []
      const record = (state) => (item, message) =>
        void results.push(message === undefined ? [state, item.id] : [state, item.id, message])
      const run = {
        name,
        request,
        isPersisted: persist,
        token: cancellation.token,
        cancel: () => cancellation.cancel(),
        results,
        output: [],
        ended: false,
        enqueued: record("enqueued"),
        started: record("started"),
        skipped: record("skipped"),
        passed: record("passed"),
        failed: record("failed"),
        errored: record("errored"),
        appendOutput: (output, _location, item) => void run.output.push({ output, test: item }),
        end: () => {
          run.ended = true
        },
      }
      controller.runs.push(run)
      return run
    },
    dispose: vi.fn(),
  }
  return controller
}
vscode.tests = { createTestController: vi.fn(createTestController) }

// jest-mock-vscode returns `undefined` where the real API returns a `Disposable`, and
// the extension pushes what these return into `context.subscriptions`. Without a real
// disposable, a test that shuts a context down the way VS Code does walks an array of
// `undefined` and cannot tell a registered listener from a leaked one.
const registrationsReturningDisposables = [
  [vscode.commands, "registerCommand"],
  [vscode.window, "registerFileDecorationProvider"],
  [vscode.window, "registerTreeDataProvider"],
  [vscode.window, "onDidChangeActiveTextEditor"],
  [vscode.workspace, "onDidChangeConfiguration"],
  [vscode.workspace, "onDidChangeWorkspaceFolders"],
  [vscode.workspace, "onDidOpenTextDocument"],
]
for (const [namespace, name] of registrationsReturningDisposables) {
  const register = namespace[name]
  namespace[name] = vi.fn(
    (...args) => register?.apply(namespace, args) ?? new vscode.Disposable(() => {}),
  )
}

module.exports = vscode
