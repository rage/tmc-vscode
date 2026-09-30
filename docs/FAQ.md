**Please do not remove/move/delete/close the (.tmc) folder in course workspaces, otherwise the TMC extension will not work properly.**

# FAQ

## Table of Contents

1. [Where can I find all actions related to TMC?](#where-can-i-find-all-actions-related-to-tmc)
2. [How can I download the next part's exercises?](#how-can-i-download-the-next-parts-exercises)
3. [How can I download unlocked/new exercises for my course?](#how-can-i-download-unlockednew-exercises-for-my-course)
4. [How do I download updates for exercises?](#how-do-i-download-updates-for-exercises)
5. [How do I wipe all data related to the TMC Extension?](#how-do-i-wipe-all-data-related-to-the-tmc-extension)
6. [Why are Copilot and other AI features off?](#why-are-copilot-and-other-ai-features-off)

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
This will delete all files and folders under the tmcdata folder and vscode storage, i.e. your course workspaces, exercises, settings, user data...

## Why are Copilot and other AI features off?

Course workspaces turn off Copilot, inline suggestions and, wherever a setting can, the AI features of other extensions. AI assistance is not allowed in course exercises unless your course allows it.

Submitting (also before a reset or restore), running tests and sharing via paste are refused while AI assistance may be on: when the course workspace's AI settings can't be applied (its `.code-workspace` file has unsaved changes or can't be written, or one of your User settings or an exercise folder's `.vscode/settings.json` turns one back on), or while an AI extension that no setting turns off is enabled, such as Cline, Roo Code, Claude Code, Codex or Continue. The message says what to change. To keep such an extension for other projects, disable it only for the course workspace with Extensions → Disable (Workspace). Nothing about this is sent anywhere.
