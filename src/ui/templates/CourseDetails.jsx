/*eslint-env browser*/

// Required for compilation, even if not referenced
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const createElement = require("./templateUtils").createElement;

// Provided by VSCode vebview at runtime
/*global acquireVsCodeApi*/

const miniSpinner = () => `<div class="spinner-border spinner-border-sm" role="status">
    <span class="sr-only">Loading...</span>
</div>`;

/**
 * @param {CourseDetailsData} data
 */
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
    const stickyTop = (course, updateableExerciseIds) => (
        <div class="w-100">
            <div class="container pt-0">
                <div class="row py-1">
                    <div class="col-md">
                        <nav aria-label="breadcrumb">
                            <ol class="breadcrumb">
                                <li class="breadcrumb-item">
                                    <a id="back-to-my-courses" href="#">
                                        My courses
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
                >
                    <div class="col-md">
                        <h2>{course.title}</h2>
                        <span>{course.description}</span>
                    </div>
                </div>
                <div class="row py-1">
                    <div class="col-md">
                        <span>
                            Points gained: {course.awardedPoints} / {course.availablePoints}
                        </span>
                    </div>
                </div>
                <div class="row py-1">
                    <div class="col-md">
                        {updateableExerciseIds.length > 0 ? (
                            <div class="alert alert-warning" role="alert">
                                <span class="mr-2">Updates found for exercises</span>
                                <button
                                    class="btn btn-danger"
                                    id="update-button"
                                    data-exercises={updateableExerciseIds}
                                >
                                    Update exercises
                                </button>
                            </div>
                        ) : null}
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
                    {exerciseGroup.downloadables.length !== 0 ? (
                        <button
                            class="btn btn-success w-100 download-all"
                            data-exercises={exerciseGroup.downloadables}
                        >
                            Download ({exerciseGroup.downloadables.length})
                        </button>
                    ) : null}
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
                                    .map((exercise) => (
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
                                                data-workspace-status={
                                                    exercise.isOpen
                                                        ? "open"
                                                        : exercise.isClosed
                                                        ? "closed"
                                                        : "missing"
                                                }
                                            >
                                                {miniSpinner()}
                                            </td>
                                        </tr>
                                    ))
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
            {stickyTop(data.course, data.updateableExerciseIds)}
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
        vscode.postMessage({ type: "openSelected", ids });
    }

    /**@param {number[]} ids*/
    function closeExercises(ids) {
        vscode.postMessage({ type: "closeSelected", ids });
    }

    function setStatusBadge(element) {
        const id = parseInt(element.dataset.exerciseId);
        switch (element.dataset.workspaceStatus) {
            case "open":
                element.innerHTML = (
                    <span class="badge badge-primary" data-status="opened">
                        opened
                    </span>
                );
                element.firstElementChild.addEventListener(
                    "click",
                    function () {
                        closeExercises([id]);
                    },
                    { once: true },
                );
                break;
            case "closed":
                element.innerHTML = (
                    <span class="badge badge-secondary" data-status="closed">
                        closed
                    </span>
                );
                element.firstElementChild.addEventListener(
                    "click",
                    function () {
                        openExercises([id]);
                    },
                    { once: true },
                );
                break;
            default:
                element.innerHTML = (
                    <span class="badge badge-secondary" data-status="missing">
                        missing
                    </span>
                );
                break;
        }
    }

    function downloadSelectedExercises(ids) {
        if (ids.length > 0) {
            vscode.postMessage({
                type: "downloadExercises",
                ids,
                courseName: course.courseName,
                organizationSlug: course.courseOrg,
                courseId: parseInt(course.courseId),
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
            vscode.postMessage({ type: type, ids });
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
        for (let i = 0; i < exerciseCards.length; i++) {
            const cardInfo = exerciseCards[i].querySelector("div.group-info");
            const exerciseTableRow = exerciseCards[i].querySelectorAll("tr.exercise-table-row");
            const allExercises = exerciseTableRow.length;

            let completed = 0;
            let open = 0;
            let downloaded = allExercises;

            for (let i = 0; i < exerciseTableRow.length; i++) {
                const c = exerciseTableRow[i].querySelector("td.exercise-completed").dataset
                    .exerciseCompleted;
                const s = exerciseTableRow[i].querySelector("td.exercise-status").dataset
                    .workspaceStatus;
                s === "open" ? open++ : s === "missing" ? downloaded-- : null;
                c === "true" ? completed++ : null;
            }

            const name = cardInfo.dataset.groupName;
            cardInfo.querySelector(
                `#completed-${name}`,
            ).innerText = `Completed ${completed} / ${allExercises}`;
            cardInfo.querySelector(
                `#downloaded-${name}`,
            ).innerText = `Downloaded ${downloaded} / ${allExercises}`;
            cardInfo.querySelector(
                `#opened-${name}`,
            ).innerText = `Open in workspace ${open} / ${allExercises}`;
        }
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

        // Course details
        const updateButton = document.getElementById("update-button");
        if (updateButton) {
            updateButton.addEventListener("click", function () {
                const updateableIds = this.dataset.exercises.split(",").map((id) => parseInt(id));
                downloadSelectedExercises(updateableIds);
            });
        }

        // Course part cards
        const openAllButtons = document.querySelectorAll("button.open-all");
        for (let i = 0; i < openAllButtons.length; i++) {
            const ids = openAllButtons[i].dataset.exercises.split(",").map((id) => parseInt(id));
            openAllButtons[i].addEventListener("click", function () {
                openExercises(ids);
            });
        }

        const closeAllButtons = document.querySelectorAll("button.close-all");
        for (let i = 0; i < closeAllButtons.length; i++) {
            const ids = closeAllButtons[i].dataset.exercises.split(",").map((id) => parseInt(id));
            closeAllButtons[i].addEventListener("click", function () {
                closeExercises(ids);
            });
        }

        const downloadAllButtons = document.querySelectorAll("button.download-all");
        for (let i = 0; i < downloadAllButtons.length; i++) {
            const ids = downloadAllButtons[i].dataset.exercises
                .split(",")
                .map((id) => parseInt(id));
            downloadAllButtons[i].addEventListener("click", function () {
                downloadSelectedExercises(ids);
            });
        }

        const toggleButtons = document.querySelectorAll("button.show-all-button");
        for (let i = 0; i < toggleButtons.length; i++) {
            const element = toggleButtons[i];
            const target = document.getElementById(`${element.dataset.groupName}-exercises`);
            element.addEventListener("click", function () {
                if (target.style.display === "none") {
                    target.style.display = "block";
                    element.innerText = "Hide exercises";
                } else {
                    target.style.display = "none";
                    element.innerText = "Show exercises";
                }
            });
        }

        const groupCheckboxCols = document.querySelectorAll("table.table");
        for (let i = 0; i < groupCheckboxCols.length; i++) {
            const theader = groupCheckboxCols[i].firstElementChild;
            const headerCheckbox = theader.querySelector("input.checkbox-xl");
            const tbody = groupCheckboxCols[i].querySelector("tbody");
            headerCheckbox.addEventListener("click", function () {
                const checkboxes = tbody.querySelectorAll("input[type='checkbox']");
                for (let i = 0; i < checkboxes.length; i++) {
                    if (checkboxes[i].checked !== this.checked) {
                        checkboxes[i].click();
                    }
                }
            });
        }

        const singleCheckboxCols = document.querySelectorAll("td.exercise-selector");
        for (let i = 0; i < singleCheckboxCols.length; i++) {
            singleCheckboxCols[i].firstElementChild.addEventListener("click", function (event) {
                selectedCount += event.target.checked ? 1 : -1;
                refreshFooter();
            });
        }

        const exerciseStatuses = document.querySelectorAll("td.exercise-status");
        for (let i = 0; i < exerciseStatuses.length; i++) {
            setStatusBadge(exerciseStatuses[i]);
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
    });

    window.addEventListener("message", function (event) {
        const message = event.data;
        switch (message.command) {
            case "exercisesOpened":
                for (let i = 0; i < message.exerciseIds?.length || 0; i++) {
                    const id = message.exerciseIds[i];
                    const element = document.getElementById(`exercise-${id}-status`);
                    element.dataset.workspaceStatus = "open";
                    setStatusBadge(element);
                }
                break;
            case "exercisesClosed":
                for (let i = 0; i < message.exerciseIds?.length || 0; i++) {
                    const id = message.exerciseIds[i];
                    const element = document.getElementById(`exercise-${id}-status`);
                    element.dataset.workspaceStatus = "closed";
                    setStatusBadge(element);
                }
                break;
            default:
                console.log("Unsupported command", message.command);
        }
        refreshCards();
    });
}

export { component, render, script };
