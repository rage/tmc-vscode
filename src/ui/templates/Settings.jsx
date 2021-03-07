// Required for compilation, even if not referenced
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const createElement = require("./templateUtils").createElement;

/*eslint-env browser*/

// Provided by VSCode vebview at runtime
/*global acquireVsCodeApi*/

/**
 * Template for Settings page.
 * @param {import("./Settings").SettingsProps} props
 */
const component = () => {
    return (
        <div class="container">
            <div class="row">
                <div class="col">
                    <h1>TMC Settings</h1>
                    <div>Here you can change TMC extension settings.</div>
                    <p>Settings are saved automatically.</p>
                </div>
            </div>
            <div class="row">
                <div class="col">
                    <div class="card-transparent border-color my-1">
                        <div class="card-body">
                            <h5 class="card-title">TMC Data</h5>
                            <div class="card-text">
                                Currently your TMC data (<span id="tmc-data-size" />) is located at:
                            </div>
                            <p class="card-text">
                                <span id="tmc-data-path" />
                            </p>
                            <button class="btn btn-primary" id="change-tmc-datapath-btn">
                                Change path
                            </button>
                        </div>
                    </div>
                    <div class="card-transparent border-color my-1">
                        <div class="card-body">
                            <h5 class="card-title">Extension logging</h5>
                            <label class="mr-2" for="log-level">
                                Choose log level:
                            </label>
                            <select id="log-level">
                                <option value="none">none</option>
                                <option value="errors">errors</option>
                                <option value="verbose">verbose</option>
                            </select>
                            <div class="btn-toolbar">
                                <button id="show-logs-btn" class="btn btn-primary mr-1">
                                    Show logs
                                </button>
                                <button id="open-logs-btn" class="btn btn-primary">
                                    Open logs folder
                                </button>
                            </div>
                        </div>
                    </div>
                    <div class="card-transparent border-color my-1">
                        <div class="card-body">
                            <h5 class="card-title">Hide Exercise Meta Files</h5>
                            <p class="card-text">
                                Hides exercise meta files, i.e. .available_points.json,
                                .tmc_test_result.json, tmc, etc.
                            </p>
                            <div class="custom-control custom-switch">
                                <input
                                    type="checkbox"
                                    class="custom-control-input"
                                    id="check-meta-files"
                                    disabled
                                />
                                <label class="custom-control-label" for="check-meta-files">
                                    Toggle to hide
                                </label>
                            </div>
                        </div>
                    </div>
                    <div class="card-transparent border-color my-1">
                        <div class="card-body">
                            <h5 class="card-title">Download old submission</h5>
                            <p class="card-text">
                                Downloads the latest submission of an exercise by default, when
                                available.
                            </p>
                            <p>
                                <strong>
                                    Note: this feature is currently unavailable and will be added
                                    back in future version.
                                </strong>
                            </p>
                            <div class="custom-control custom-switch">
                                <input
                                    type="checkbox"
                                    class="custom-control-input"
                                    id="download-old-submission"
                                    disabled
                                />
                                <label class="custom-control-label" for="download-old-submission">
                                    Toggle to enable
                                </label>
                            </div>
                        </div>
                    </div>
                    <div class="card-transparent border-color my-1">
                        <div class="card-body">
                            <h5 class="card-title">Update exercises automatically</h5>
                            <p class="card-text">
                                Downloads any available updates to exercises automatically. If
                                turned off, shows a notification instead.
                            </p>
                            <div class="custom-control custom-switch">
                                <input
                                    type="checkbox"
                                    class="custom-control-input"
                                    id="update-exercises-automatically"
                                    disabled
                                />
                                <label
                                    class="custom-control-label"
                                    for="update-exercises-automatically"
                                >
                                    Toggle to enable
                                </label>
                            </div>
                        </div>
                    </div>
                    <div class="card-transparent border-color my-1">
                        <div class="card-body">
                            <h5 class="card-title">Editor: Open Side By Side Direction</h5>
                            <p class="card-text">
                                Controls the default direction of editors that are opened side by
                                side (e.g. from the explorer). By default, editors will open on the
                                right hand side of the currently active one. If changed to down, the
                                editors will open below the currently active one.
                            </p>
                            <button class="btn btn-primary" id="open-direction-btn">
                                Change in VS Code settings
                            </button>
                        </div>
                    </div>
                    <div class="card-transparent border-color my-1">
                        <div class="card-body">
                            <h5 class="card-title">Insider version</h5>
                            <p class="card-text">
                                Toggle this on if you wish to use and test TestMyCode extension
                                upcoming features and enhancements. New features might not be
                                visible by eye and might crash the extension. You can always opt-out
                                if something isn't working and use the stable version.
                            </p>
                            <p class="card-text">
                                If you encounter any issues, please report them to our Github{" "}
                                <a href="https://github.com/rage/tmc-vscode/issues/new/choose">
                                    issues
                                </a>
                                .
                            </p>
                            <div class="custom-control custom-switch">
                                <input
                                    id="insider-version-toggle"
                                    type="checkbox"
                                    class="custom-control-input"
                                    disabled
                                />
                                <label class="custom-control-label" for="insider-version-toggle">
                                    None available
                                </label>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const script = () => {
    const vscode = acquireVsCodeApi();

    const changeTMCDataPathButton = document.getElementById("change-tmc-datapath-btn");
    changeTMCDataPathButton.addEventListener("click", () => {
        vscode.postMessage({ type: "changeTmcDataPath" });
    });

    const logLevelSelect = document.getElementById("log-level");
    logLevelSelect.addEventListener("input", () => {
        const level = logLevelSelect.options[logLevelSelect.selectedIndex].value;
        vscode.postMessage({ type: "changeLogLevel", data: level });
    });

    const showLogsButton = document.getElementById("show-logs-btn");
    showLogsButton.addEventListener("click", () => {
        vscode.postMessage({ type: "showLogsToUser" });
    });

    const openLogsFolderButton = document.getElementById("open-logs-btn");
    openLogsFolderButton.addEventListener("click", () => {
        vscode.postMessage({ type: "openLogsFolder" });
    });

    const hideMetaFilesToggle = document.getElementById("check-meta-files");
    hideMetaFilesToggle.addEventListener("click", (event) => {
        hideMetaFilesToggle.disabled = true;
        vscode.postMessage({ type: "hideMetaFiles", data: event.target.checked });
    });

    const downloadOldSubmissionToggle = document.getElementById("download-old-submission");
    downloadOldSubmissionToggle.addEventListener("click", (event) => {
        downloadOldSubmissionToggle.disabled = true;
        vscode.postMessage({ type: "downloadOldSubmissionSetting", data: event.target.checked });
    });

    const updateExercisesAutomaticallyToggle = document.getElementById(
        "update-exercises-automatically",
    );
    updateExercisesAutomaticallyToggle.addEventListener("click", (event) => {
        updateExercisesAutomaticallyToggle.disabled = true;
        vscode.postMessage({
            type: "updateExercisesAutomaticallySetting",
            data: event.target.checked,
        });
    });

    const openDirectionButton = document.getElementById("open-direction-btn");
    openDirectionButton.addEventListener("click", () => {
        updateExercisesAutomaticallyToggle.disabled = true;
        vscode.postMessage({ type: "openEditorDirection" });
    });

    const insiderToggle = document.getElementById("insider-version-toggle");
    insiderToggle.addEventListener("click", (event) => {
        insiderToggle.disabled = true;
        vscode.postMessage({ type: "insiderStatus", data: event.target.checked });
    });

    const tmcDataPath = document.getElementById("tmc-data-path");
    const tmcDataSize = document.getElementById("tmc-data-size");
    window.addEventListener("message", (event) => {
        for (let i = 0; i < event.data.length; i++) {
            /**@type {import("../types").WebviewMessage} */
            const message = event.data[i];
            switch (message.command) {
                case "setBooleanSetting":
                    switch (message.setting) {
                        case "downloadOldSubmission":
                            downloadOldSubmissionToggle.checked = message.enabled;
                            downloadOldSubmissionToggle.disabled = false;
                            break;
                        case "hideMetaFiles":
                            hideMetaFilesToggle.checked = message.enabled;
                            hideMetaFilesToggle.disabled = false;
                            break;
                        // No insider versions available
                        // case "insider":
                        //     insiderToggle.checked = message.enabled;
                        //     insiderToggle.disabled = false;
                        //     break;
                        case "updateExercisesAutomatically":
                            updateExercisesAutomaticallyToggle.checked = message.enabled;
                            updateExercisesAutomaticallyToggle.disabled = false;
                            break;
                    }
                    break;
                case "setLogLevel": {
                    console.log(message.level);
                    for (let i = 0; i < logLevelSelect.options.length; i++) {
                        if (logLevelSelect.options[i].value === message.level) {
                            logLevelSelect.selectedIndex = i;
                            break;
                        }
                    }
                    break;
                }
                case "setTmcDataFolder":
                    tmcDataPath.innerText = message.path;
                    tmcDataSize.innerText = message.diskSize;
                    break;
            }
        }
    });
};

export { component, script };
