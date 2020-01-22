import TMC from "./api/tmc";
import UI from "./ui/ui";

/**
 * Registers the various actions and handlers required for the user interface to function.
 * Should only be called once.
 *
 * TODO: split up into reasonable pieces as functionality expands
 * @param ui The User Interface object
 * @param tmc The TMC API object
 */
export function registerUiActions(ui: UI, tmc: TMC) {

    // Logs out, closes the webview, hides the logout command, shows the login command
    ui.treeDP.registerAction("logout", () => {
        tmc.deauthenticate();
        ui.webview.dispose();
        ui.treeDP.setVisibility("logout", false);
        ui.treeDP.setVisibility("login", true);
    }, false);

    // Displays the login webview
    ui.treeDP.registerAction("login", () => {
        ui.webview.setContent(loginHTML(ui));
    }, true);

    // Receives a login information from the webview, attempts to log in
    // If successful, show the logout command instead of the login one, and a temporary webview page
    ui.webview.registerHandler("login", async (msg: { type: string, username: string, password: string }) => {
        console.log("Logging in as " + msg.username);
        const result = await tmc.authenticate(msg.username, msg.password);
        if (result.success) {
            console.log("Logged in successfully");
            ui.treeDP.setVisibility("login", false);
            ui.treeDP.setVisibility("logout", true);
            ui.webview.setContent(ui.webview.htmlWrap("Logged in."));
        } else {
            console.log("Login failed: " + result.errorDesc);
            ui.webview.setContent(loginHTML(ui, result.errorDesc));
        }
    });
}

/**
 * Temporary helper function, to be replaced with an HTML templating engine
 * @param ui The UI object, could be refactored to not be needed
 * @param error An error message to displayed to the user
 */
function loginHTML(ui: UI, error?: string): string {
    let errorElement = "";
    if (error) {
        errorElement = `<p class="error">${error}</p>`;
    }
    return ui.webview.htmlWrap(
        `<h1>Login</h1>
        ${errorElement}
        <form id="loginform">
        Email or username:<br>
        <input type="text" id="username"><br>
        Password:<br>
        <input type="password" id="password"><br>
        <input type="submit">
        <script>
            const vscode = acquireVsCodeApi();
            const form = document.getElementById("loginform");
            const usernameField = document.getElementById("username");
            const passwordField = document.getElementById("password");
            form.onsubmit = () => {
                vscode.postMessage({type: "login", username: usernameField.value, password: passwordField.value});
                form.reset();
            }
        </script>
        </form>`);
}
