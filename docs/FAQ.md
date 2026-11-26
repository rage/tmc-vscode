**Please do not remove/move/delete/close the (.tmc) folder in course workspaces, otherwise the TMC extension will not work properly.**

# FAQ

## Table of Contents

1. [Where can I find all actions related to TMC?](#where-can-i-find-all-actions-related-to-tmc)
2. [How can I download the next part's exercises?](#how-can-i-download-the-next-parts-exercises)
3. [How can I download unlocked/new exercises for my course?](#how-can-i-download-unlockednew-exercises-for-my-course)
4. [How do I download updates for exercises?](#how-do-i-download-updates-for-exercises)
5. [How do I wipe all data related to the TMC Extension?](#how-do-i-wipe-all-data-related-to-the-tmc-extension)
6. [Why are Copilot and other AI features off?](#why-are-copilot-and-other-ai-features-off)
7. [Why does VS Code ask whether I trust the course workspace?](#why-does-vs-code-ask-whether-i-trust-the-course-workspace)
8. [How does logging in with a code work?](#how-does-logging-in-with-a-code-work)
9. [My submission is still waiting for grading](#my-submission-is-still-waiting-for-grading)
10. [Tries and deadlines](#tries-and-deadlines)
11. [I lost access to a course](#i-lost-access-to-a-course)
12. [How do I report a bug?](#how-do-i-report-a-bug)
13. [What does the extension send, and where?](#what-does-the-extension-send-and-where)
14. [What happens when I uninstall the extension?](#what-happens-when-i-uninstall-the-extension)
15. [Which systems and editors are supported?](#which-systems-and-editors-are-supported)

Downloads, antivirus, proxy and network problems: [troubleshooting](troubleshooting.md).

## Where can I find all actions related to TMC?

Open the Command Palette (`CTRL + SHIFT + P`) and type `TestMyCode` to see all the extension's commands. Some of them are offered only while an exercise file is open. With an exercise file open, its item in the status bar lists that exercise's actions.

## How can I download the next part's exercises?

On the left of Visual Studio Code, press the TestMyCode icon to open the Courses view and expand your course. Each part lists its exercises; use the download button on a part, or on an exercise, to download it. A part appears once it is unlocked.

## How can I download unlocked/new exercises for my course?

Visual Studio Code will occasionally prompt you to download new exercises.
You can also download new exercises by pressing the TestMyCode icon on the left in Visual Studio Code and using the download button beside your course in the Courses view.  
You can also run `TestMyCode: Download New Exercises...` from the Command Palette (`CTRL + SHIFT + P`).

## How do I download updates for exercises?

Visual Studio Code will occasionally prompt you to download updates for exercises.
You can also download updates by pressing the TestMyCode icon on the left in Visual Studio Code: if updates are available, your course in the Courses view has an `Update Exercises` button beside it.  
You can also run `TestMyCode: Update Exercises` from the Command Palette (`CTRL + SHIFT + P`).

## How do I wipe all data related to the TMC Extension?

If open, close course workspace, press `CTRL + SHIFT + P` and run `TestMyCode: Wipe All Extension Data...`.  
This will delete all files and folders under the tmcdata folder and vscode storage, i.e. your course workspaces, exercises, settings, user data... Wipe removes everything, including your login.

## Why are Copilot and other AI features off?

A course's AI policy is a classroom rule that the extension helps you keep; it is not a control. It is enforced inside VS Code on a best-effort basis, and the server accepts submissions from any client.

Course workspaces turn off Copilot, inline suggestions and, wherever a setting can, the AI features of other extensions. Only the policies `full_use` and `required` leave AI on; `not_set`, `limited` and `planning_only` are treated as no AI. Courses that restrict AI are refused in editors whose built-in AI cannot be switched off, such as Cursor and Windsurf.

Submitting (also before a reset or restore), running tests and sharing via paste are refused while AI assistance may be on: when the course workspace's AI settings can't be applied (its `.code-workspace` file has unsaved changes or can't be written, or one of your User settings, or an exercise folder's `.vscode/settings.json` that can't be written, turns one back on), or while an AI extension that no setting turns off is enabled, such as Cline, Roo Code, Claude Code, Codex or Continue. The message says what to change. To keep such an extension for other projects, disable it only for the course workspace with Extensions → Disable (Workspace). Nothing about this is sent anywhere.

## Why does VS Code ask whether I trust the course workspace?

Running tests and submitting run your exercise code, which VS Code allows only in a trusted workspace. When a course workspace opens untrusted, TestMyCode asks you to trust it; choose **Trust Workspace & Continue** (**Yes, I trust the authors** in older VS Code versions). VS Code asks again for each exercise downloaded while the course workspace is open; answer **Yes**.

If you chose not to trust it, the workspace is in Restricted Mode: you can still download and open exercises, but running tests, submitting and sharing via paste are held back. Run `TestMyCode: Trust Course Workspace` from the Command Palette (`CTRL + SHIFT + P`), or use the button in the Courses view, to be asked again.

## How does logging in with a code work?

**Log In** shows a login code and opens the MOOC.fi website. Check that the page shows the same code, then approve the login; TestMyCode waits until you do. You never type your password into VS Code. If the code expires or you deny it, select **Log In** again. One MOOC.fi account works for every course on courses.mooc.fi and tmc.mooc.fi.

## My submission is still waiting for grading

Grading can take a while when many students submit at once. After a minute or so the result screen offers **Keep Waiting**; select it, or close the screen and open the exercise's **History** later. The submission is not lost.

## Tries and deadlines

The Courses view and the course home show each exercise's points, deadline and tries left. A submission after the deadline, or with no tries left, is refused, and Get Help and Reset are not offered when no tries are left. Ask your teacher about extensions.

## I lost access to a course

If your course access has ended, or the course was closed, downloads and submissions for it fail with a message that says so. Check that you are logged in with the MOOC.fi account you enrolled with (the status bar shows it), and ask your teacher or the course staff. Exercises you already downloaded stay on your computer.

## How do I report a bug?

Open the error's details and select **Copy Details**, run **TestMyCode: Show Logs**, and attach both to an issue at https://github.com/rage/tmc-vscode/issues. Do not include your login code.

## What does the extension send, and where?

The extension has no trackers or telemetry.

- **Submit** uploads the exercise folder (only your solution) to the course's server. Before a **Reset** or **Restore**, the current state of the folder is uploaded as a backup submission too.
- **Get Help** uploads your solution and gives you a link your teacher or classmates can open. The owner and the course staff can always open it. If the code did not pass all tests, anyone who is logged in can open it; if it passed, only students with full points on that exercise can.
- The TestMyCode tools are downloaded once from download.mooc.fi.
- Requests to the course servers carry the version of this extension and the version of the TestMyCode tools, which the servers use to block outdated and misbehaving versions. The servers may check submissions for plagiarism and use the sending IP address to block spam and abuse.
- Run Tests sends nothing.

## What happens when I uninstall the extension?

Uninstalling removes the courses.mooc.fi login on this computer, not your exercises. To remove the exercises too, run `TestMyCode: Wipe All Extension Data...` before uninstalling.

## Which systems and editors are supported?

- Windows (x86_64), macOS (Intel and Apple silicon), Linux (x86_64 and arm64). Visual Studio Code 1.100 or newer; older editors keep receiving TestMyCode 3.5.x, which has no courses.mooc.fi support, because 1.100 is the first version with the APIs this version needs.
- Linux needs glibc 2.30 or newer; the next version of the tools needs 2.28.
- In WSL, Remote-SSH, Dev Containers and Codespaces the extension runs on the remote side, with its own login and its own exercises.
- Set `HTTPS_PROXY` for a proxy. The next version of the tools also uses the system proxy on Windows and macOS; PAC-only setups are not supported.
- VSCodium and other editors that can switch their built-in AI off work. Cursor, Windsurf and similar editors cannot run courses that restrict AI.
