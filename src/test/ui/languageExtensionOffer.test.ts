import * as vscode from "vscode"

import type Dialog from "../../api/dialog"
import type WorkspaceManager from "../../api/workspaceManager"
import { LanguageExtensionOffer } from "../../ui/languageExtensionOffer"
import { createMockMemento } from "../mocks/vscode"

const EXERCISE_FILE = vscode.Uri.file("/tmc/projects/course/hello/src/hello.py")
const OTHER_FILE = vscode.Uri.file("/home/student/notes.py")

function document(uri: vscode.Uri, languageId = "python"): vscode.TextDocument {
  return { uri, languageId } as unknown as vscode.TextDocument
}

suite("LanguageExtensionOffer", function () {
  let notification: ReturnType<typeof vi.fn>
  let installed: string[]
  let globalState: vscode.Memento
  let offer: LanguageExtensionOffer

  function createOffer(openDocuments: vscode.TextDocument[] = []): LanguageExtensionOffer {
    return new LanguageExtensionOffer(
      { notification } as unknown as Pick<Dialog, "notification">,
      {
        getExerciseContaining: (uri: vscode.Uri) =>
          uri.path.startsWith("/tmc/projects/") ? { uri } : undefined,
      } as unknown as Pick<WorkspaceManager, "getExerciseContaining">,
      globalState,
      openDocuments,
      new vscode.EventEmitter<vscode.TextDocument>().event,
    )
  }

  beforeEach(function () {
    notification = vi.fn(async () => {})
    installed = []
    vi.mocked(vscode.extensions.getExtension).mockImplementation(((id: string) =>
      installed.includes(id) ? { id } : undefined) as typeof vscode.extensions.getExtension)
    globalState = createMockMemento()
    offer = createOffer()
  })

  afterEach(function () {
    offer.dispose()
    vi.mocked(vscode.extensions.getExtension).mockReset()
  })

  test("offers Install the first time an exercise file of the language opens", async function () {
    await offer.consider(document(EXERCISE_FILE))

    expect(notification).toHaveBeenCalledOnce()
    expect(notification).toHaveBeenCalledWith(
      "Install the Python extension to run and debug your code.",
      ["Install", expect.any(Function)],
    )
  })

  test("offers once per language, even for files opened together and in a new window", async function () {
    await Promise.all([
      offer.consider(document(EXERCISE_FILE)),
      offer.consider(document(EXERCISE_FILE)),
    ])
    await createOffer().consider(document(EXERCISE_FILE))

    expect(notification).toHaveBeenCalledOnce()
  })

  test("offers nothing for a file outside the exercises or of another language", async function () {
    await offer.consider(document(OTHER_FILE))
    await offer.consider(document(EXERCISE_FILE, "markdown"))

    expect(notification).not.toHaveBeenCalled()
  })

  test("offers nothing while the extension is installed, and again once it is gone", async function () {
    await offer.consider(document(EXERCISE_FILE))
    installed = ["ms-python.python"]
    await offer.consider(document(EXERCISE_FILE))
    installed = []

    await offer.consider(document(EXERCISE_FILE))

    expect(notification).toHaveBeenCalledTimes(2)
  })

  test("considers the exercise files already open when it starts", async function () {
    offer.dispose()
    offer = createOffer([document(EXERCISE_FILE)])

    await offer.consider(document(OTHER_FILE))

    expect(notification).toHaveBeenCalledOnce()
  })

  test("Install installs the extension", async function () {
    const executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)
    onTestFinished(() => executeCommand.mockRestore())
    await offer.consider(document(EXERCISE_FILE))

    const [, [, install]] = notification.mock.calls[0] as [string, [string, () => void]]
    install()

    expect(executeCommand).toHaveBeenCalledWith(
      "workbench.extensions.installExtension",
      "ms-python.python",
    )
  })
})
