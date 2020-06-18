export const EXTENSION_ID = "moocfi.test-my-code";
export const OUTPUT_CHANNEL_NAME = "TestMyCode";
export const TMC_JAR_URL = "https://download.mooc.fi/tmc-langs/tmc-langs-cli-0.8.1-SNAPSHOT.jar";
export const TMC_JAR_NAME = "tmc-langs-cli-0.8.1-SNAPSHOT.jar";
export const JAVA_ZIP_URLS: {
    linux32?: string;
    linux64?: string;
    windows32?: string;
    windows64?: string;
} = {
    linux64: "https://download.mooc.fi/tmc-vscode/OpenJDK8U-jre_x64_linux_hotspot_8u252b09.zip",
    windows32:
        "https://download.mooc.fi/tmc-vscode/OpenJDK8U-jre_x86-32_windows_hotspot_8u252b09.zip",
    windows64: "https://download.mooc.fi/tmc-vscode/OpenJDK8U-jre_x64_windows_hotspot_8u252b09.zip",
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

/** Delay for when TMC-Langs process should be killed. */
export const TMC_LANGS_TIMEOUT = 60 * 1000;

/**
 * Delay for notifications that offer a "remind me later" option.
 */
export const NOTIFICATION_DELAY = 30 * 60 * 1000;

export const EXERCISE_CHECK_INTERVAL = 30 * 60 * 1000;

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

Workspace:
    The Workspace contains all currently open exercises for each course. 
    You can manage the status of the exercises via the TMC extension.

    NB! 
    Please manage, i.e. close, open and download, exercises only via the TMC extension or by using our premade commands. 
    Moving/deleting/renaming folders manually currently breaks the TMC extensions state and could potentially remove files and folders automatically.
    Files and folders can only be created under the exercise folders, all other will be automatically deleted.`;
