import { Uri } from "vscode";

interface WelcomeProps {
    /** Version if the plugin to show to the user. */
    version: string;
    newWorkspace: Uri;
    openNewWorkspace: Uri;
    TMCMenuIcon: Uri;
    newTMCMenu: Uri;
    tmcLogoFile: Uri;
}

export function component(welcomeProps: WelcomeProps): unknown;
export function render(welcomeProps: WelcomeProps): string;
export function script(): unknown;
