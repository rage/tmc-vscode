import { Results } from "ts-results";
import * as vscode from "vscode";

import TMC from "../../api/tmc";
import Storage from "../../config/storage";
import { AuthenticationError } from "../../errors";
import UI from "../ui";
import { HandlerContext } from "./types";

/**
 * Returns a handler that downloads given exercises and opens them in VSCode explorer, when called.
 * @param ui UI instance used for setting up the webview afterwards
 * @param tmc TMC API instance used for downloading exercises
 */
export function downloadExercises({ ui, tmc }: HandlerContext) {
    return async (msg: { type: string, ids: number[], organizationSlug: string, courseName: string }) => {
        ui.webview.setContentFromTemplate("loading");
        const results = Results(...await Promise.all(msg.ids.map(
            (x) => tmc.downloadExercise(x, msg.organizationSlug))));
        if (results.ok) {
            console.log("opening downloaded exercises in: ", results.val);
            ui.webview.dispose();
            // TODO: get proper exercise name from API
            // TODO: allow downloading exercises without opening them
        } else {
            vscode.window.showErrorMessage("One or more exercise downloads failed.");
        }
    };
}

/**
 * Returns a handler that handles authentication with TMC server when called.
 * @param ui UI instance used for setting up the webview afterwards
 * @param storage Storage for storing authorization token on successful login
 * @param tmc TMC API instance used for downloading exercises
 */
export function handleLogin({ ui, storage, tmc }: HandlerContext) {
    return async (msg: { type: string, username: string, password: string }) => {
        if (!msg.username || !msg.password) {
            ui.webview.setContentFromTemplate("login", { error: "Username and password may not be empty." });
            return;
        }
        const result = await tmc.authenticate(msg.username, msg.password);
        if (result.ok) {
            ui.treeDP.updateVisibility(["loggedIn"]);
            storage.getOrganizationSlug() === undefined ? ui.treeDP.triggerCallback("orgs") : ui.treeDP.triggerCallback("index");
        } else {
            console.log("Login failed: " + result.val.message);
            ui.webview.setContentFromTemplate("login", { error: result.val.message });
        }
    };
}

/**
 * Returns a handler that sets the current selected organization when called.
 * @param ui UI instance used for setting up the webview afterwards
 * @param storage Storage for updating currently selected organization
 */
export function setOrganization({ ui, storage }: HandlerContext) {
    return async (msg: { type: string, slug: string }) => {
        console.log("Organization selected:", msg.slug);
        storage.updateOrganizationSlug(msg.slug);
        ui.treeDP.updateVisibility(["orgChosen"]);
        ui.treeDP.triggerCallback("courses");
    };
}

/**
 * Returns a handler that sets the current selected course when called.
 * @param ui UI instance used for setting up the webview afterwards
 * @param storage Storage for updating currently selected organization
 */
export function setCourse({ ui, storage }: HandlerContext) {
    return async (msg: { type: string, id: number }) => {
        console.log("Course selected:", msg.id);
        storage.updateCourseId(msg.id);
        ui.treeDP.updateVisibility(["courseChosen"]);
        ui.treeDP.triggerCallback("courseDetails");
    };
}
