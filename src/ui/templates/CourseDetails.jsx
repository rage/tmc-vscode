/*eslint-env browser*/

// Required for compilation, even if not referenced
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const createElement = require("./templateUtils").createElement;

/**
 * @param {string} cspBlob
 * @param {string} cssBlob
 * @param {CourseDetailsData} data
 */
function component(cspBlob, cssBlob, data) {
    const getHardDeadlineInformation = (deadline) =>
        "This is a soft deadline and it can be exceeded." +
        "&#013Exercises can be submitted after the soft deadline has passed, " +
        "but you receive only 75% of the exercise points." +
        `&#013;Hard deadline for this exercise is: ${deadline}.` +
        "&#013;Hard deadline can not be exceeded.";

    /**
     * @param {number} id
     */
    const getOpenedBadge = (id) => (
        <span class="badge badge-primary" onclick={`closeExercise(${id})`}>
            open
        </span>
    );

    /**
     * @param {number} id
     */
    const getClosedBadge = (id) => (
        <span class="badge badge-secondary" onclick={`openExercise(${id})`}>
            closed
        </span>
    );

    const getMissingBadge = () => <span class="badge badge-secondary">missing</span>;

    /**
     * @param {string} title
     * @param {string} description
     */
    const stickyTop = (title, description) => (
        <div class="w-100 sticky-top">
            <div class="container pt-0">
                <div class="row">
                    <div class="col">
                        <nav aria-label="breadcrumb">
                            <ol class="breadcrumb">
                                <li class="breadcrumb-item">
                                    <a onclick="backToMyCourses()" href="#">
                                        My courses
                                    </a>
                                </li>
                                <li class="breadcrumb-item" aria-current="page">
                                    {title}
                                </li>
                            </ol>
                        </nav>
                    </div>
                </div>
                <div class="row">
                    <div class="col-sm">
                        <h2>{title}</h2>
                        <span>{description}</span>
                    </div>
                </div>
                <div class="row mt-2">
                    <div class="col-sm-3">
                        <button class="btn-info m-1 w-100" onclick="downloadView()">
                            Download exercises
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );

    const exerciseTable = (exerciseGroup) => (
        <div class="container container-fluid border-current-color my-3">
            <div class="row">
                <div class="col-md">
                    <h2 style="text-transform: capitalize;">{exerciseGroup.name}</h2>
                </div>
                <div class="col-md-2 my-1">
                    <button class="btn-info w-100">Download all (7)</button>
                </div>
                <div class="col-md-2 my-1">
                    <button class="btn-info w-100">Open all</button>
                </div>
                <div class="col-md-2 my-1">
                    <button class="btn-info w-100">Close all</button>
                </div>
            </div>
            <div class="row pt-3">
                <div class="col-md-5">{exerciseGroup.nextDeadlineString}</div>
                <div class="col-md-2">
                    <button
                        class="show-all-button"
                        onclick={`toggleCollapse(document.getElementById('${exerciseGroup.name}-exercises'), 'block')`}
                    >
                        Show all
                    </button>
                </div>
            </div>
            <div class="row">
                <div class="col-md" id={`${exerciseGroup.name}-exercises`} style="display: none;">
                    <hr />
                    <div class="table-responsive-md">
                        <table class="table table-striped table-borderless">
                            <thead>
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
                            <tbody>
                                {exerciseGroup.exercises
                                    .map((exercise) => (
                                        <tr>
                                            <td class="min-w-5 text-center">
                                                <input
                                                    class="checkbox-xl"
                                                    type="checkbox"
                                                    data-isPassed={exercise.passed}
                                                    value={exercise.id}
                                                    onchange="updateCount(this)"
                                                />
                                            </td>
                                            <td class="min-w-40">{exercise.name}</td>
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
                                            <td class="min-w-10">
                                                {exercise.passed ? "&#10004;" : "&#10060;"}
                                            </td>
                                            <td
                                                class="min-w-15"
                                                id={`exercise-${exercise.id}-status`}
                                            >
                                                {exercise.isOpen
                                                    ? getOpenedBadge(exercise.id)
                                                    : exercise.isClosed
                                                    ? getClosedBadge(exercise.id)
                                                    : getMissingBadge()}
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
        <div
            id="contextMenu"
            class="container fixed-bottom"
            style="visibility: hidden; background-color: inherit; padding: 0;"
        >
            <div class="card border" style="background-color: inherit;">
                <div class="card-body">
                    Select action for <span id="selectedCount">0</span> selected items
                    <div class="row mt-2">
                        <div class="col-sm-3">
                            <button
                                class="btn-info m-1 w-100"
                                onclick="handleSelected('openSelected')"
                            >
                                Open
                            </button>
                        </div>
                        <div class="col-sm-3">
                            <button
                                class="btn-info m-1 w-100"
                                onclick="handleSelected('closeSelected')"
                            >
                                Close
                            </button>
                        </div>
                        <div class="col-sm-3">
                            <button class="btn-info m-1 w-100" onclick="clearAll()">
                                Clear selections
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );

    let vscode;
    let courseId;
    let selectedCount;

    function backToMyCourses() {
        vscode.postMessage({ type: "myCourses" });
    }

    function downloadView() {
        vscode.postMessage({ type: "exerciseDownloads", id: courseId });
    }

    function toggleCollapse(element, defaultDisplay) {
        element.style.display = element.style.display === "none" ? defaultDisplay : "none";
    }

    function openExercise(id) {
        vscode.postMessage({ type: "openSelected", ids: [id], id: courseId });
    }

    function closeExercise(id) {
        vscode.postMessage({ type: "closeSelected", ids: [id], id: courseId });
    }

    function updateCount(element) {
        selectedCount += element.checked ? 1 : -1;
        refreshFooter();
    }

    function clearAll() {
        const checkboxes = document.querySelectorAll("input[type='checkbox']");
        for (let i = 0; i < checkboxes.length; i++) {
            checkboxes[i].checked = false;
        }
        selectedCount = 0;
        refreshFooter();
    }

    function handleSelected(type) {
        const checkboxes = document.querySelectorAll("input[type='checkbox']");
        const ids = [];
        for (let i = 0; i < checkboxes.length; i++) {
            if (checkboxes[i].checked) {
                ids.push(parseInt(checkboxes[i].value));
            }
        }
        if (ids.length > 0) {
            vscode.postMessage({ type: type, ids, id: courseId });
        }
    }

    function refreshFooter() {
        document.getElementById("selectedCount").innerText = selectedCount;
        document.getElementById("contextMenu").style.visibility =
            selectedCount === 0 ? "hidden" : "visible";
        document.getElementById("body").style.marginBottom =
            selectedCount === 0
                ? "0px"
                : document.getElementById("contextMenu").offsetHeight + 20 + "px";
    }

    function messageHandler(event) {
        const message = event.data;
        switch (message.command) {
            case "exercisesOpened":
                for (let i = 0; i < message.exerciseIds?.length || 0; i++) {
                    const id = message.exerciseIds[i];
                    console.log(`exercise-${id}-status`);
                    document.getElementById(`exercise-${id}-status`).innerHTML = getOpenedBadge(id);
                }
                break;
            case "exercisesClosed":
                for (let i = 0; i < message.exerciseIds?.length || 0; i++) {
                    const id = message.exerciseIds[i];
                    console.log(`exercise-${id}-status`);
                    document.getElementById(`exercise-${id}-status`).innerHTML = getClosedBadge(id);
                }
                break;
            default:
                console.log("Unsupported command", message.command);
        }
    }

    return (
        <html>
            <head>
                <meta charSet="UTF-8" />
                {cspBlob}
                <style>{cssBlob}</style>
            </head>
            <body id="body" class="p-0">
                {stickyTop(data.course.title, data.course.description)}
                {data.exerciseData.map(exerciseTable).join("")}
                {contextMenu()}
                <script>
                    {"const vscode = acquireVsCodeApi();"}
                    {`const courseId = ${data.course.id};`}
                    {"selectedCount = 0;"}
                    {createElement}
                    {getOpenedBadge}
                    {getClosedBadge}
                    {getMissingBadge}
                    {backToMyCourses}
                    {downloadView}
                    {toggleCollapse}
                    {openExercise}
                    {closeExercise}
                    {updateCount}
                    {clearAll}
                    {handleSelected}
                    {refreshFooter}
                    {`window.addEventListener("message", ${messageHandler})`}
                </script>
            </body>
        </html>
    );
}

function render(cspBlob, cssBlob, data) {
    return component(cspBlob, cssBlob, data).toString();
}

export { component, render };
