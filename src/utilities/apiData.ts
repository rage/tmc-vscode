import {
    LOCAL_EXERCISE_AVAILABLE_POINTS_PLACEHOLDER,
    LOCAL_EXERCISE_AWARDED_POINTS_PLACEHOLDER,
    LOCAL_EXERCISE_UNAWARDED_POINTS_PLACEHOLDER,
} from "../config/constants";
import { CourseExercise, Exercise } from "../shared/langsSchema";
import { TmcLocalCourseExercise } from "../storage/data";

/**
 * Takes exercise arrays from two different endpoints and attempts to resolve them into
 * `LocalCourseExercise`. Uses common default values, if matching id is not found from
 * `courseExercises`.
 */
export function combineTmcApiExerciseData(
    exercises: Exercise[],
    courseExercises: CourseExercise[],
): TmcLocalCourseExercise[] {
    const exercisePointsMap = new Map(courseExercises.map((x) => [x.id, x]));
    return exercises.map<TmcLocalCourseExercise>((x) => {
        const match = exercisePointsMap.get(x.id);
        const passed = x.completed;
        const awardedPointsFallback = passed
            ? LOCAL_EXERCISE_AWARDED_POINTS_PLACEHOLDER
            : LOCAL_EXERCISE_UNAWARDED_POINTS_PLACEHOLDER;
        const localCourseExercise: TmcLocalCourseExercise = {
            id: x.id,
            availablePoints:
                match?.available_points.length ?? LOCAL_EXERCISE_AVAILABLE_POINTS_PLACEHOLDER,
            awardedPoints: match?.awarded_points.length ?? awardedPointsFallback,
            name: x.name,
            deadline: x.deadline,
            passed: x.completed,
            softDeadline: x.soft_deadline,
        };
        return localCourseExercise;
    });
}
