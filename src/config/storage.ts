import * as oauth2 from "client-oauth2";
import * as vscode from "vscode";
import { LocalExerciseData } from "../api/types";

import { LocalCourseData } from "./userdata";

/**
 * Interface class for accessing stored TMC configuration and data.
 */
export default class Storage {

    private context: vscode.ExtensionContext;

    /**
     * Creates new instance of the TMC storage access object.
     * @param context context of the extension where all data is stored
     */
    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    /**
     * Gets currently stored course.
     * @returns currently stored course id or undefined if not set
     */
    public getCourseId(): number | undefined {
        return this.context.globalState.get("course");
    }

    /**
     * Gets currently stored organization slug.
     * @returns currently stored organization slug or undefined if not set
     */
    public getOrganizationSlug(): string | undefined {
        return this.context.globalState.get("organization");
    }

    /**
     * Gets currently stored authentication token.
     * @returns currently stored authentication token or undefined if not set
     */
    public getAuthenticationToken(): oauth2.Data | undefined {
        return this.context.globalState.get("token");
    }

    public getExerciseData(): LocalExerciseData[] | undefined {
        return this.context.globalState.get("exerciseData");

    }
    public getUserData(): {courses: LocalCourseData[]} | undefined {
        return this.context.globalState.get("userData");
    }

    /**
     * Updates the given course id in storage.
     * @param courseId course id to update
     */
    public updateCourseId(courseId: number | undefined) {
        this.context.globalState.update("course", courseId);
    }

    /**
     * Updates the given organization slug in storage.
     * @param organizationSlug organization slug to update
     */
    public updateOrganizationSlug(organizationSlug: string | undefined) {
        this.context.globalState.update("organization", organizationSlug);
    }

    /**
     * Updates the given authentication token in storage.
     * @param authenticationToken authentication token to update
     */
    public updateAuthenticationToken(authenticationToken: oauth2.Data | undefined) {
        this.context.globalState.update("token", authenticationToken);
    }

    public updateExerciseData(exerciseData: LocalExerciseData[] | undefined) {
        this.context.globalState.update("exerciseData", exerciseData);
    }

    public updateUserData(userData: {courses: LocalCourseData[]}) {
        this.context.globalState.update("userData", userData);
    }
}
