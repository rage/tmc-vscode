// Required for compilation, even if not referenced

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const createElement = require("./templateUtils").createElement;

/*eslint-env browser*/

// Provided by VSCode vebview at runtime
/*global acquireVsCodeApi*/

/**
 * Template for My Courses page.
 * @param {import("./MyCourses").MyCoursesProps} props
 */
const component = (props) => {
    const { courses } = props;

    /**@param {import("../../config/types").LocalCourseData} course*/
    const mapCourse = (course) => {
        const completedPrc = ((course.awardedPoints / course.availablePoints) * 100).toFixed(2);
        return (
            <div
                class="row org-row border-current-color course-card"
                id={`course-${course.id}`}
                data-course-id={course.id}
                data-course-name={course.name}
                data-organization-slug={course.organization}
                data-se="course-card"
            >
                <div class="col-md">
                    <button
                        type="button"
                        class="close remove-course-btn"
                        aria-label="remove course"
                    >
                        <span aria-hidden="true">&times;</span>
                    </button>
                    <h3>
                        {course.title} <small class="text-muted">{course.name}</small>
                    </h3>
                    <p>{course.description}</p>
                    <div class="row">
                        <div class="col-md" id={`course-${course.id}-next-deadline`}>
                            <span
                                class="spinner-border spinner-border-sm"
                                role="status"
                                aria-hidden="true"
                            ></span>
                        </div>
                        <div class="col-sm" style="text-align: right;">
                            <button
                                type="button"
                                class="btn btn-primary open-workspace-btn"
                                aria-label="Open workspace"
                            >
                                <span aria-hidden="true">Open workspace</span>
                            </button>
                        </div>
                    </div>
                    <div
                        role="alert"
                        class="alert alert-info course-disabled-notification my-1"
                        style="display: none;"
                    >
                        This course has been disabled. Exercises cannot be downloaded or submitted.
                    </div>
                    <div>
                        Programming exercise progress:
                        <div class="progress">
                            <div
                                class="progress-bar bg-success"
                                role="progressbar"
                                style={`width: ${completedPrc}%`}
                                aria-valuenow={completedPrc}
                                aria-valuemin="0"
                                aria-valuemax="100"
                            >
                                {completedPrc} %
                            </div>
                        </div>
                    </div>
                    <div
                        class="alert alert-info alert-dismissible mt-2 new-exercises-notification"
                        role="alert"
                        style="display: block;"
                    >
                        <span class="new-exercises-count">0</span> new exercises found for this
                        course.
                        <button
                            type="button"
                            class="btn btn-success ml-1 download-new-exercises-btn"
                            data-new-exercises={course.newExercises}
                        >
                            Download them!
                        </button>
                        <button
                            type="button"
                            class="close clear-new-exercises-btn"
                            aria-label="Close"
                        >
                            <span aria-hidden="true">&times;</span>
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div class="container">
            <div class="row py-2">
                <div class="col-md-8">
                    <h1 data-se="my-courses-title">My Courses</h1>
                    <div>
                        <input
                            type="button"
                            class="btn btn-primary mb-4 mt-2"
                            id="add-new-course"
                            value="Add new course"
                            data-se="add-new-course"
                        />
                    </div>
                </div>
                <div class="col-md-4">
                    <h5>TMC Data</h5>
                    <div>
                        Currently your TMC data (<span id="tmc-data-size" />) is located at:
                    </div>
                    <p>
                        <span id="tmc-data-path" />
                    </p>
                    <button class="btn btn-secondary btn-sm" id="change-tmc-datapath-btn">
                        Change path
                    </button>
                </div>
            </div>
            {courses.length > 0 ? (
                courses.map(mapCourse).join("")
            ) : (
                <div class="row">
                    <div class="col-md">Add courses to start completing exercises.</div>
                </div>
            )}
        </div>
    );
};

const script = () => {
    const vscode = acquireVsCodeApi();

    document.getElementById("add-new-course").addEventListener("click", () => {
        vscode.postMessage({ type: "addCourse" });
    });
    const changeTMCDataPathButton = document.getElementById("change-tmc-datapath-btn");
    changeTMCDataPathButton.addEventListener("click", () => {
        vscode.postMessage({ type: "changeTmcDataPath" });
    });

    /**
     * @param {number} courseId
     * @param {number[]} exerciseIds
     */
    function setNewExercises(courseId, exerciseIds) {
        const course = document.getElementById(`course-${courseId}`);
        if (!course) {
            return;
        }
        const notification = course.querySelector("div.new-exercises-notification");
        const button = notification.querySelector("button.download-new-exercises-btn");

        const count = exerciseIds.length;
        notification.querySelector("span.new-exercises-count").innerText = count;
        if (count === 0) {
            button.disabled = true;
            notification.style.display = "none";
        } else {
            button.disabled = false;
            button.dataset.newExercises = exerciseIds;
            notification.style.display = "block";
        }
    }

    function setCourseDisabledStatus(courseId, disabled) {
        const course = document.getElementById(`course-${courseId}`);
        if (!course) {
            return;
        }
        const notification = course.querySelector("div.course-disabled-notification");
        if (disabled) {
            notification.style.display = "block";
        } else {
            notification.style.display = "none";
        }
    }

    const courses = document.querySelectorAll("div.course-card");
    for (let i = 0; i < courses.length; i++) {
        const course = courses[i];
        const courseId = parseInt(course.dataset.courseId);
        const courseName = course.dataset.courseName;
        const organizationSlug = course.dataset.organizationSlug;

        course.addEventListener("click", () => {
            vscode.postMessage({ type: "courseDetails", id: courseId, useCache: true });
        });

        course.querySelector("button.remove-course-btn").addEventListener("click", (event) => {
            event.stopPropagation();
            vscode.postMessage({ type: "removeCourse", id: courseId });
        });

        course.querySelector("button.open-workspace-btn").addEventListener("click", (event) => {
            event.stopPropagation();
            vscode.postMessage({ type: "openCourseWorkspace", name: courseName });
        });

        const newExercisesButton = course.querySelector("button.download-new-exercises-btn");
        newExercisesButton.addEventListener("click", (event) => {
            event.stopPropagation();
            setNewExercises(courseId, []);
            vscode.postMessage({
                type: "downloadExercises",
                ids: newExercisesButton.dataset.newExercises.split(",").map(Number),
                courseName,
                organizationSlug,
                courseId,
                mode: "download",
            });
        });
        const clearNewExercisesButton = course.querySelector("button.clear-new-exercises-btn");
        clearNewExercisesButton.addEventListener("click", (event) => {
            event.stopPropagation();
            setNewExercises(courseId, []);
            vscode.postMessage({
                type: "clearNewExercises",
                courseId,
            });
        });
    }

    const tmcDataPath = document.getElementById("tmc-data-path");
    const tmcDataSize = document.getElementById("tmc-data-size");
    window.addEventListener("message", (event) => {
        for (let i = 0; i < event.data.length; i++) {
            /**@type {import("../types").WebviewMessage} */
            const message = event.data[i];
            switch (message.command) {
                case "setNextCourseDeadline": {
                    const deadlineField = document.getElementById(
                        `course-${message.courseId}-next-deadline`,
                    );
                    if (deadlineField) {
                        deadlineField.innerText = message.deadline;
                    }
                    break;
                }
                case "setNewExercises": {
                    setNewExercises(message.courseId, message.exerciseIds);
                    break;
                }
                case "setCourseDisabledStatus": {
                    setCourseDisabledStatus(message.courseId, message.disabled);
                    break;
                }
                case "setTmcDataFolder": {
                    tmcDataPath.innerText = message.path;
                    tmcDataSize.innerText = message.diskSize;
                    break;
                }
            }
        }
    });
};

export { component, script };
