/*eslint-env browser*/

// Required for compilation, even if not referenced
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const createElement = require("./templateUtils").createElement;

// Provided by VSCode vebview at runtime
/*global acquireVsCodeApi*/

function component(data) {
    const getHardDeadlineInformation = (deadline) =>
        "This is a soft deadline and it can be exceeded." +
        "&#013Exercises can be submitted after the soft deadline has passed, " +
        "but you receive only 75% of the exercise points." +
        `&#013;Hard deadline for this exercise is: ${deadline}.` +
        "&#013;Hard deadline can not be exceeded.";

    /**
     * @param {string} title
     * @param {string} description
     */
    const stickyTop = (course, offlineMode, perhapsExamMode, courseDisabled, materialUrl) => (
        <div class="w-100">
            <div class="container pt-0">
                <div class="row py-1">
                    <div class="col-md">
                        <nav aria-label="breadcrumb">
                            <ol class="breadcrumb">
                                <li class="breadcrumb-item">
                                    <a id="back-to-my-courses" href="#">
                                        My Courses
                                    </a>
                                </li>
                                <li class="breadcrumb-item" aria-current="page">
                                    {course.title}
                                </li>
                            </ol>
                        </nav>
                    </div>
                </div>
                <div
                    class="row py-1"
                    id="course"
                    data-course-id={course.id}
                    data-course-name={course.name}
                    data-course-org={course.organization}
                    data-course-disabled={course.disabled}
                >
                    <div class="col-md-10">
                        <h2>{course.title}</h2>
                        <span>{course.description}</span>
                    </div>
                    <div class="col-md-2" style="text-align: right;">
                        <button class="btn btn-primary" id="refresh-button" aria-label="Refresh">
                            Refresh
                        </button>
                    </div>
                </div>
                <div class="row py-1">
                    <div class="col-md">
                        <span>
                            Points gained: {course.awardedPoints} / {course.availablePoints}
                        </span>
                    </div>
                </div>
                {materialUrl ? (
                    <div class="row py-1">
                        <div class="col-md">
                            Material: <a href={materialUrl}>{materialUrl}</a>
                        </div>
                    </div>
                ) : null}
                <div class="row py-1">
                    <div class="col-md">
                        <button
                            class="btn btn-primary"
                            id="open-workspace"
                            aria-label="Open workspace"
                        >
                            Open workspace
                        </button>
                    </div>
                </div>
                <div class="row py-1">
                    <div class="col-md">
                        <div
                            class="alert alert-warning update-notification"
                            role="alert"
                            style="display: none"
                        >
                            <span class="mr-2">Updates found for exercises</span>
                            <button class="btn btn-danger update-button">Update exercises</button>
                        </div>
                        {offlineMode ? (
                            <div class="alert alert-warning" role="alert">
                                <span>
                                    Unable to fetch exercise data from server. Displaying local
                                    exercises.
                                </span>
                            </div>
                        ) : null}
                        {perhapsExamMode ? (
                            <div class="alert alert-info" role="alert">
                                <span>
                                    This is an exam. Exercise submission results will not be shown.
                                </span>
                            </div>
                        ) : null}
                        <div
                            role="alert"
                            style="display: none;"
                            class="alert alert-info"
                            id="course-disabled-notification"
                        >
                            This course has been disabled. Exercises cannot be downloaded or
                            submitted.
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );

    const exerciseTable = (exerciseGroup) => (
        <div class="container container-fluid border-current-color my-3 exercise-card">
            <div class="row">
                <div class="col-md">
                    <h2 style="text-transform: capitalize;">{exerciseGroup.name}</h2>
                </div>
                <div class="col-md-2 my-1">
                    <button class="btn btn-success w-100 download-all" style="display: none;">
                        Download (<span>0</span>)
                    </button>
                </div>
                <div class="col-md-2 my-1">
                    <button
                        class="btn btn-primary w-100 open-all"
                        data-exercises={exerciseGroup.exercises.map((e) => e.id)}
                    >
                        Open all
                    </button>
                </div>
                <div class="col-md-2 my-1">
                    <button
                        class="btn btn-primary w-100 close-all"
                        data-exercises={exerciseGroup.exercises.map((e) => e.id)}
                    >
                        Close all
                    </button>
                </div>
            </div>
            <div class="row py-1">
                <div class="col-md group-info" data-group-name={exerciseGroup.name}>
                    <div id={`completed-${exerciseGroup.name}`}>Completed 0/0</div>
                    <div id={`downloaded-${exerciseGroup.name}`}>Downloaded 0/0</div>
                    <div id={`opened-${exerciseGroup.name}`}>Opened 0/0</div>
                </div>
            </div>
            <div class="row pt-2">
                <div class="col-md-5">{exerciseGroup.nextDeadlineString}</div>
                <div class="col-md-2 text-center">
                    <button class="show-all-button" data-group-name={exerciseGroup.name}>
                        Show exercises
                    </button>
                </div>
            </div>
            <div class="row">
                <div class="col-md" id={`${exerciseGroup.name}-exercises`} style="display: none;">
                    <hr />
                    <div class="table-responsive-md">
                        <table class="table table-striped table-borderless exercise-table">
                            <thead id={`${exerciseGroup.name}-table-headers`}>
                                <tr>
                                    <th class="min-w-5 text-center">
                                        <input class="checkbox-xl" type="checkbox" />
                                    </th>
                                    <th class="min-w-40">Exercise</th>
                                    <th class="min-w-30">Deadline</th>
                                    <th class="min-w-10">Completed</th>
                                    <th class="min-w-15">Status</th>
                                </tr>
                            </thead>
                            <tbody class="exercise-tbody">
                                {exerciseGroup.exercises
                                    .map((exercise) => {
                                        return (
                                            <tr class="exercise-table-row" id={exercise.id}>
                                                <td class="min-w-5 text-center exercise-selector">
                                                    <input
                                                        class="checkbox-xl"
                                                        type="checkbox"
                                                        value={exercise.id}
                                                    />
                                                </td>
                                                <td class="min-w-40 text-break">{exercise.name}</td>
                                                <td class="min-w-30">
                                                    {exercise.isHard ? (
                                                        exercise.hardDeadlineString
                                                    ) : (
                                                        <div>
                                                            {exercise.softDeadlineString}
                                                            <span
                                                                class="font-weight-bold"
                                                                title={getHardDeadlineInformation(
                                                                    exercise.hardDeadlineString,
                                                                )}
                                                            >
                                                                &#9432;
                                                            </span>
                                                        </div>
                                                    )}
                                                </td>
                                                <td
                                                    class="min-w-10 exercise-completed"
                                                    data-exercise-completed={exercise.passed}
                                                >
                                                    {exercise.passed ? "&#10004;" : "&#10060;"}
                                                </td>
                                                <td
                                                    class="min-w-15 exercise-status"
                                                    id={`exercise-${exercise.id}-status`}
                                                    data-exercise-id={exercise.id}
                                                >
                                                    loading...
                                                </td>
                                            </tr>
                                        );
                                    })
                                    .join("")}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );

    const contextMenu = () => (
        <div id="context-menu" class="container fixed-bottom">
            <div class="card border-current-color" style="background-color: inherit;">
                <div class="card-body">
                    Select action for <span id="selected-count">0</span> selected items
                    <div class="row mt-2">
                        <div class="col-md-3">
                            <button class="btn btn-primary m-1 w-100" id="open-selected">
                                Open
                            </button>
                        </div>
                        <div class="col-md-3">
                            <button class="btn btn-primary m-1 w-100" id="close-selected">
                                Close
                            </button>
                        </div>
                        <div class="col-md-3">
                            <button
                                class="btn btn-primary m-1 w-100"
                                id="download-selected"
                                disabled
                            >
                                Download
                            </button>
                        </div>
                        <div class="col-md-3">
                            <button class="btn btn-primary m-1 w-100" id="clear-all-selections">
                                Clear selections
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );

    return (
        <div>
            {stickyTop(
                data.course,
                data.offlineMode,
                data.course.perhapsExamMode,
                data.course.disabled,
                data.course.material_url,
            )}
            {data.exerciseData.map(exerciseTable).join("")}
            {contextMenu()}
        </div>
    );
}

function render(cspBlob, cssBlob, data) {
    return component(cspBlob, cssBlob, data).toString();
}

function script() {
    const vscode = acquireVsCodeApi();
    const course = document.getElementById("course").dataset;
    let contextMenu;
    let selectedCount = 0;

    /**@param {number[]} ids*/
    function openExercises(ids) {
        vscode.postMessage({ type: "openSelected", ids, courseName: course.courseName });
    }

    /**@param {number[]} ids*/
    function closeExercises(ids) {
        vscode.postMessage({ type: "closeSelected", ids, courseName: course.courseName });
    }

    /**
     * @param {HTMLElement} element
     * @param {import("../types").ExerciseStatus} status
     */
    function setStatusBadge(element, status) {
        const id = parseInt(element.dataset.exerciseId);
        if (status) {
            element.dataset.workspaceStatus = status;
        }
        let html;
        let handler;
        switch (element.dataset.workspaceStatus) {
            case "opened":
                html = (
                    <span class="badge badge-primary" data-status="opened">
                        opened
                    </span>
                );
                handler = () => closeExercises([id]);
                break;
            case "closed":
                html = (
                    <span class="badge badge-secondary" data-status="closed">
                        closed
                    </span>
                );
                handler = () => openExercises([id]);
                break;
            case "downloading":
                html = (
                    <div class="spinner-border spinner-border-sm" role="status">
                        <span class="sr-only">Loading...</span>
                    </div>
                );
                break;
            case "downloadFailed":
                html = (
                    <span class="badge badge-danger" data-status="downloadFailed">
                        failed
                    </span>
                );
                break;
            case "expired":
                html = (
                    <span class="badge badge-dark" data-status="expired">
                        expired
                    </span>
                );
                break;
            case "new":
                html = (
                    <span class="badge badge-success" data-status="new">
                        new!
                    </span>
                );
                break;
            default:
                html = (
                    <span class="badge badge-warning" data-status="unknown">
                        {element.dataset.workspaceStatus}
                    </span>
                );
                break;
        }
        element.innerHTML = html;
        if (handler) {
            element.firstElementChild.addEventListener("click", handler, { once: true });
        }
    }

    function setCourseDisabledStatus(courseId, disabled) {
        const contextMenuDownloadSelected = document.getElementById("download-selected");
        const notification = document.getElementById("course-disabled-notification");
        if (disabled) {
            contextMenuDownloadSelected.disabled = true;
            notification.style.display = "block";
        } else {
            contextMenuDownloadSelected.disabled = false;
            notification.style.display = "none";
        }
    }

    /**
     * @param {string} courseId
     * @param {number[]} exerciseIds
     */
    function setUpdateableExercises(courseId, exerciseIds) {
        if (course.courseId !== courseId) {
            return;
        }

        const notification = document.querySelector("div.update-notification");
        const button = notification.querySelector("button.update-button");

        if (exerciseIds.length === 0) {
            button.disabled = true;
            notification.style.display = "none";
        } else {
            button.disabled = false;
            button.dataset.exercises = exerciseIds;
            notification.style.display = "block";
        }
    }

    function downloadSelectedExercises(ids, mode) {
        if (ids.length > 0) {
            vscode.postMessage({
                type: "downloadExercises",
                ids,
                courseName: course.courseName,
                organizationSlug: course.courseOrg,
                courseId: parseInt(course.courseId),
                mode,
            });
        }
    }

    function handleSelected(type) {
        const checkboxCols = document.querySelectorAll("td.exercise-selector");
        const ids = [];
        for (let i = 0; i < checkboxCols.length; i++) {
            if (checkboxCols[i].firstElementChild.checked) {
                ids.push(parseInt(checkboxCols[i].firstElementChild.value));
            }
        }
        if (ids.length > 0) {
            if (type === "downloadExercises") {
                downloadSelectedExercises(ids, "download");
            }
            vscode.postMessage({ type: type, ids, courseName: course.courseName });
        }
    }

    function refreshFooter() {
        contextMenu.querySelector("#selected-count").innerText = selectedCount;
        contextMenu.style.visibility = selectedCount === 0 ? "hidden" : "visible";
        document.querySelector("body").style.marginBottom =
            selectedCount === 0
                ? "0px"
                : document.getElementById("context-menu").offsetHeight + 20 + "px";
    }

    function refreshCards() {
        const exerciseCards = document.querySelectorAll("div.exercise-card");
        let totalDownloading = 0;
        for (let i = 0; i < exerciseCards.length; i++) {
            const cardInfo = exerciseCards[i].querySelector("div.group-info");
            const exerciseTableRow = exerciseCards[i].querySelectorAll("tr.exercise-table-row");
            const allExercises = exerciseTableRow.length;

            let opened = 0;
            let closed = 0;
            let completed = 0;
            let downloadable = [];

            for (let j = 0; j < exerciseTableRow.length; j++) {
                if (
                    exerciseTableRow[j].querySelector("td.exercise-completed").dataset
                        .exerciseCompleted === "true"
                ) {
                    completed++;
                }

                const s = exerciseTableRow[j].querySelector("td.exercise-status").dataset
                    .workspaceStatus;
                switch (s) {
                    case "opened":
                        opened++;
                        break;
                    case "closed":
                        closed++;
                        break;
                    case "downloading":
                        totalDownloading++;
                        break;
                    case "new":
                    case "expired":
                    case "missing":
                        downloadable.push(exerciseTableRow[j].id);
                        break;
                }
            }
            const downloadAllButton = exerciseCards[i].querySelector("button.download-all");
            downloadAllButton.dataset.exercises = downloadable;
            if (downloadable.length === 0 || course.courseDisabled === "true") {
                downloadAllButton.style.display = "none";
                downloadAllButton.disabled = true;
            } else {
                downloadAllButton.style.display = "block";
                downloadAllButton.disabled = false;
            }
            downloadAllButton.style.display = downloadable.length === 0 ? "none" : "block";
            downloadAllButton.querySelector("span").innerText = downloadable.length;

            exerciseCards[i].querySelector("button.open-all").disabled = closed === 0;
            exerciseCards[i].querySelector("button.close-all").disabled = opened === 0;

            const name = cardInfo.dataset.groupName;
            cardInfo.querySelector(
                `#completed-${name}`,
            ).innerText = `Completed ${completed} / ${allExercises}`;
            cardInfo.querySelector(`#downloaded-${name}`).innerText = `Downloaded ${
                opened + closed
            } / ${allExercises}`;
            cardInfo.querySelector(
                `#opened-${name}`,
            ).innerText = `Open in workspace ${opened} / ${allExercises}`;
        }
        document.getElementById("refresh-button").disabled = totalDownloading > 0;
        document.getElementById("open-workspace").disabled = totalDownloading > 0;
    }

    document.addEventListener("DOMContentLoaded", function () {
        contextMenu = document.getElementById("context-menu");
        refreshCards();

        // Breadcrumbs
        document.getElementById("back-to-my-courses").addEventListener(
            "click",
            function () {
                vscode.postMessage({ type: "myCourses" });
            },
            { once: true },
        );

        const refreshButton = document.getElementById("refresh-button");
        if (refreshButton) {
            refreshButton.addEventListener(
                "click",
                function () {
                    refreshButton.disabled = true;
                    refreshButton.innerHTML =
                        '<span class="spinner-grow spinner-grow-sm" role="status" aria-hidden="true"></span>Refreshing';
                    vscode.postMessage({
                        type: "courseDetails",
                        id: parseInt(course.courseId),
                        useCache: false,
                    });
                },
                { once: true },
            );
        }

        // Open workspace
        const workspaceButton = document.getElementById("open-workspace");
        if (workspaceButton) {
            workspaceButton.addEventListener("click", function () {
                vscode.postMessage({ type: "openCourseWorkspace", name: course.courseName });
            });
        }

        // Exercise updates
        const updateNotification = document.querySelector("div.update-notification");
        const updateButton = updateNotification.querySelector("button.update-button");
        if (updateButton) {
            updateButton.addEventListener("click", function () {
                updateButton.disabled = true;
                const updateableIds = this.dataset.exercises.split(",").map((id) => parseInt(id));
                downloadSelectedExercises(updateableIds, "update");
            });
        }

        // Course part cards
        const exerciseCards = document.querySelectorAll("div.exercise-card");
        for (let i = 0; i < exerciseCards.length; i++) {
            const exerciseCard = exerciseCards[i];

            const openAllButton = exerciseCard.querySelector("button.open-all");
            if (openAllButton) {
                const ids = openAllButton.dataset.exercises.split(",").map((id) => parseInt(id));
                openAllButton.addEventListener("click", function () {
                    openAllButton.disabled = true;
                    openExercises(ids);
                });
            }

            const closeAllButton = exerciseCard.querySelector("button.close-all");
            if (closeAllButton) {
                const ids = closeAllButton.dataset.exercises.split(",").map((id) => parseInt(id));
                closeAllButton.addEventListener("click", function () {
                    closeAllButton.disabled = true;
                    closeExercises(ids);
                });
            }

            const toggleButton = exerciseCard.querySelector("button.show-all-button");
            const exerciseTable = exerciseCard.querySelector(
                `#${toggleButton.dataset.groupName}-exercises`,
            );
            if (toggleButton && exerciseTable) {
                toggleButton.addEventListener("click", function () {
                    if (exerciseTable.style.display === "none") {
                        exerciseTable.style.display = "block";
                        toggleButton.innerText = "Hide exercises";
                    } else {
                        exerciseTable.style.display = "none";
                        toggleButton.innerText = "Show exercises";
                    }
                });
            }

            const downloadAllButton = exerciseCard.querySelector("button.download-all");
            if (downloadAllButton) {
                downloadAllButton.addEventListener("click", function () {
                    downloadAllButton.disabled = true;
                    const ids = downloadAllButton.dataset.exercises
                        .split(",")
                        .map((id) => parseInt(id));
                    for (let i = 0; i < ids.length; i++) {
                        setStatusBadge(
                            exerciseTable.querySelector(`#exercise-${ids[i]}-status`),
                            "downloading",
                        );
                    }
                    downloadSelectedExercises(ids, "download");
                });
            }

            if (exerciseTable) {
                const theader = exerciseTable.querySelector("thead");
                const tbody = exerciseTable.querySelector("tbody");
                const headerCheckbox = theader.querySelector("input.checkbox-xl");
                headerCheckbox.addEventListener("click", function () {
                    const checkboxes = tbody.querySelectorAll("input[type='checkbox']");
                    for (let j = 0; j < checkboxes.length; j++) {
                        if (checkboxes[j].checked !== this.checked) {
                            checkboxes[j].click();
                        }
                    }
                });

                const exerciseTableRows = exerciseTable.querySelectorAll("tr.exercise-table-row");
                for (let j = 0; j < exerciseTableRows.length; j++) {
                    const exerciseTableRow = exerciseTableRows[j];
                    const singleCheckboxColumn = exerciseTableRow.querySelector(
                        "td.exercise-selector",
                    );
                    if (singleCheckboxColumn) {
                        singleCheckboxColumn.firstElementChild.addEventListener(
                            "click",
                            function (event) {
                                selectedCount += event.target.checked ? 1 : -1;
                                refreshFooter();
                            },
                        );
                    }
                }
            }
        }

        // Context menu
        document.getElementById("clear-all-selections").addEventListener("click", function () {
            const checkboxes = document.querySelectorAll("input[type='checkbox']");
            for (let i = 0; i < checkboxes.length; i++) {
                checkboxes[i].checked = false;
            }
            selectedCount = 0;
            refreshFooter();
        });

        document.getElementById("open-selected").addEventListener("click", function () {
            handleSelected("openSelected");
        });

        document.getElementById("close-selected").addEventListener("click", function () {
            handleSelected("closeSelected");
        });
        document.getElementById("download-selected").addEventListener("click", function () {
            handleSelected("downloadExercises");
        });
    });

    window.addEventListener("message", function (event) {
        for (let i = 0; i < event.data.length; i++) {
            /**@type {import("../types").WebviewMessage} */
            const message = event.data[i];
            switch (message.command) {
                case "exerciseStatusChange": {
                    const element = document.getElementById(
                        `exercise-${message.exerciseId}-status`,
                    );
                    setStatusBadge(element, message.status);
                    break;
                }
                case "setUpdateables": {
                    setUpdateableExercises(message.courseId.toString(), message.exerciseIds);
                    break;
                }
                case "setCourseDisabledStatus": {
                    setCourseDisabledStatus(message.courseId, message.disabled);
                    break;
                }
                default:
                    console.log("Unsupported command", message.command);
            }
        }
        refreshCards();
    });
}

export { component, render, script };
