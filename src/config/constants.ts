export const EXTENSION_ID = "moocfi.test-my-code";
export const TMC_JAR_URL = "https://download.mooc.fi/tmc-langs/tmc-langs-cli-0.7.17-SNAPSHOT.jar";
export const TMC_JAR_NAME = "tmc-langs-cli-0.7.17-SNAPSHOT.jar";
export const JAVA_ZIP_URLS = {
    windows64:
        "https://github.com/AdoptOpenJDK/openjdk8-binaries/releases/download/jdk8u212-b04/OpenJDK8U-jdk_x64_windows_hotspot_8u212b04.zip",
    windows32:
        "https://github.com/AdoptOpenJDK/openjdk8-binaries/releases/download/jdk8u242-b08_openj9-0.18.1/OpenJDK8U-jdk_x86-32_windows_openj9_8u242b08_openj9-0.18.1.zip",
};
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

/**
 * Delay for notifications that offer a "remind me later" option.
 */
export const NOTIFICATION_DELAY = 30 * 60 * 1000;

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

    TMC - Get exercise submissions
        You can download old submissions by choosing 'Download old submissions' from the TMC Menu.
    
TMC Extension settings
    You can open the TMC extension settings by pressing the TMC icon on the left sidebar and choose 'Settings' in the TestMyCode extension menu.

    TMC Data
    This is the location where all TMC extension data is saved.  
    Changing the location will create a 'tmcdata' folder to your chosen location and move all the TMC data to the new location.`;
