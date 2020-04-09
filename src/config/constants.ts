export const EXTENSION_ID = "moocfi.test-my-code";
export const TMC_JAR = "https://download.mooc.fi/tmc-langs/tmc-langs-cli-0.7.16-SNAPSHOT.jar";
export const TMC_API_URL = "https://tmc.mooc.fi/api/v8/";
export const ACCESS_TOKEN_URI = "https://tmc.mooc.fi/oauth/token";
export const CLIENT_ID = "72065a25dc4d3e9decdf8f49174a3e393756478d198833c64f6e5584946394f0";
export const CLIENT_SECRET = "3e6c4df1992e4031d316ea1933e350e9658326a67efb2e65a5b15207bdc09ee8";
export const WORKSPACE_SETTINGS = {
    folders: [{ path: "Exercises" }],
    settings: {
        "workbench.editor.closeOnFileDelete": true,
        "files.autoSave": "onFocusChange",
    },
};

export const EMPTY_HTML_DOCUMENT = `<html><head><meta http-equiv="${"Content-Security-Policy"}" content="default-src 'none';" /></head></html>`;

/**
 * If changed WORKSPACEROOTFILE is changed, remember to update
 * "workspaceContains:**\TMC-Readme.txt", with the new name below
 */
export const WORKSPACE_ROOT_FILE = "TMC-Readme.txt";

export const WORKSPACE_ROOT_FILE_TEXT = `
The TMC Extension activates on startup if following conditions are met:
    - The TMC Workspace is open in your Visual Studio Code editor
    - ${WORKSPACE_ROOT_FILE} is found in the TMC Workspace root folder (i.e. Exercises).

---
Workspace:
    The Workspace contains all currently open exercises for each course. 
    You can manage the status of the exercises via the TMC extension.

    NB! 
    Please manage, i.e. close, open and download, exercises only via the TMC extension or by using our premade commands. 
    Moving/deleting/renaming folders manually currently breaks the TMC extensions state.
    Files and folders can only be created under the exercise folders, all other will be automatically deleted.
---

These commands can be executed for the TMC exercise that is currently open and active in the VSCode editor.

Commands (VSCode command hotkey: CTRL + SHIFT + P):
    TMC - Menu
    TMC - Run tests
    TMC - Submit solution
    TMC - Reset exercise
    TMC - Close exercise
    TMC - Paste exercise

    TMC - Menu (hotkey: CTRL + SHIFT + A):
        A list of all available commands can also be found under the TMC Menu.

    TMC - Run tests (hotkey: CTRL + SHIFT + T):
        Run exercise tests on your computer.

    TMC - Submit solution
        Send the exercise to the TMC server for testing and grading.

    TMC - Paste exercise
        Send the TMC exercise code to the TMC Pastebin.

    TMC - Reset exercise
        Send the exercise files to the TMC server (for backup) and delete all the exercise files on your computer. 
        Downloads the exercise template from the TMC Server and opens it to the TMC Workspace.

    TMC - Close exercise (hotkey: CTRL + SHIFT + C)
        Closes the exercise folder from the TMC workspace.
    
    Settings in settings view(Settings button in activity bar):
    
    Change exercise download location:
        You can determine where downloaded exercises are stored in the settings view by pressing "Change path" button.
        Current download path is shown in the view. You should restart code after setting up the new download path.`;
