import { CourseDetailsData } from "../types";

/**
 * @param {string} cspBlob
 * @param {string} cssBlob
 */
declare function component(data: CourseDetailsData): unknown;

/**
 * @param {string} cspBlob
 * @param {string} cssBlob
 */
declare function render(data: CourseDetailsData): string;

declare function script(): unknown;

export { component, render, script };
