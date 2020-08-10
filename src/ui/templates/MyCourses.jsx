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

    /**@param {import("./MyCourses").MyCoursesProps["courses"]} courses*/
    const mapCourses = (courses) =>
        courses.map((course) => {
            const completedPrc = ((course.awardedPoints / course.availablePoints) * 100).toFixed(2);
            return (
                <div
                    class="row org-row border-current-color course-card"
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
                        {course.disabled ? (
                            <div role="alert" class="alert alert-info">
                                This course has been disabled and exercises can't be downloaded or
                                submitted to the server.
                            </div>
                        ) : null}
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
                            class="alert alert-info mt-2"
                            role="alert"
                            style={`display: ${course.newExercises.length > 0 ? "block" : "none"}`}
                        >
                            <span>
                                {course.newExercises.length} new exercises found for this course.
                            </span>
                            <button
                                type="button"
                                class="btn btn-success ml-1 download-new-exercises-btn"
                                data-new-exercises={course.newExercises}
                            >
                                Download them!
                            </button>
                        </div>
                    </div>
                </div>
            );
        });

    return (
        <div class="container">
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
            {mapCourses(courses).join("")}
        </div>
    );
};

const script = () => {
    const vscode = acquireVsCodeApi();

    document.getElementById("add-new-course").addEventListener("click", () => {
        vscode.postMessage({ type: "addCourse" });
    });

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
        newExercisesButton.addEventListener(
            "click",
            (event) => {
                event.stopPropagation();
                newExercisesButton.style.display = "none";
                vscode.postMessage({
                    type: "downloadExercises",
                    ids: newExercisesButton.dataset.split(",").map(Number),
                    courseName,
                    organizationSlug,
                    courseId,
                    mode: "download",
                });
            },
            { once: true },
        );
    }

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
            }
        }
    });
};

export { component, script };
