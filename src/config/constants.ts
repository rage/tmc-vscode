export const TMC_JAR = "https://download.mooc.fi/tmc-langs/tmc-langs-cli-0.7.16-SNAPSHOT.jar";

/**
 * If changed WORKSPACEROOTFILE is changed, remember to update
 * "workspaceContains:**\TMC-Readme.txt", with the new name below
 */
export const WORKSPACE_ROOT_FILE = "TMC-Readme.txt";

export const WORKSPACE_ROOT_FILE_TEXT = `This extension provides TestMyCode integration for Visual Studio Code. 

To use extension you will need:
    - TestMyCode account (tmc.mooc.fi)
    - Java runtime (for packing/unpacking and testing exercises)
    - Course-specific system environment

Getting started: 
    1. Select the TMC icon on the activity bar.
    2. First time initialization will take some time! Please pay attention to the notifications.
    3. Select Log in from the TestMyCode menu.
    4. Enter your TMC credentials and log in.

TMC Extension activates itself on startup if the TMC Workspace is open in your VSCode editor and this file is found in the Workspace.

---

Workspace:
    The Workspace contains all currently open exercises for each course. 
    You can manage the status of the exercises via the TMC extension.

    NB! Please close and open exercises only via the TMC extension or by using our premade commands. 
    Moving/deleting/renaming folders manually currently breaks the TMC extensions state.

---

These commands can be executed for the TMC exercise that is currently open and active in the VSCode editor.
Commands (VSCode command hotkey: CTRL + SHIFT + P):
    TMC - Run tests
    TMC - Submit solution
    TMC - Reset exercise
    TMC - Close exercise

TMC - Run tests (hotkey: CTRL + SHIFT + T):
    Run exercise tests on your computer.

TMC - Submit solution
    Send the exercise to the TMC server for testing and grading.

TMC - Reset exercise
    Send the exercise files to the TMC server (for backup) and delete all the exercise files on your computer. 
    Downloads the exercise template from the TMC Server and opens it to the workspace.

TMC - Close exercise (hotkey: CTRL + SHIFT + C)
    Closes the exercise folder from the TMC workspace.`;

export const WORKSPACE_SETTINGS = {
    folders: [{ path: "Exercises" }],
    settings: {
        "workbench.editor.closeOnFileDelete": true,
        "files.autoSave": "onFocusChange",
    },
};
