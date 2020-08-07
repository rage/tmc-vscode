// Required for compilation, even if not referenced
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const createElement = require("./templateUtils").createElement;

/*eslint-env browser*/

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
                <div class="row org-row border-current-color" data-se="course-card">
                    <div class="col-md" id={`course-${course.id}`}>
                        <button type="button" class="close" aria-label="remove course">
                            <span aria-hidden="true">&times;</span>
                        </button>
                        <h3>
                            {course.title}
                            <small class="text-muted">{course.name}</small>
                        </h3>
                        <p>{course.description}</p>
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
                        {course.newExercises.length > 0 ? (
                            <div
                                class="alert alert-info mt-2"
                                role="alert"
                                id={`new-exercise-${course.id}`}
                            >
                                <span>
                                    {course.newExercises.length} new exercises found for this
                                    course.
                                </span>
                                <button type="button" class="btn btn-success ml-1 ">
                                    Download them!
                                </button>
                            </div>
                        ) : null}
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
                    value="Add new course"
                    data-se="add-new-course"
                />
            </div>
            {mapCourses(courses).join("")}
        </div>
    );
};

export { component };
