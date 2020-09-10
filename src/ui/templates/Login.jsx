// Required for compilation, even if not referenced

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const createElement = require("./templateUtils").createElement;

/*eslint-env browser*/

// Provided by VSCode vebview at runtime
/*global acquireVsCodeApi*/

const component = () => {
    return (
        <div class="container fluid">
            <div class="row">
                <div class="col-md-6">
                    <h1>Login</h1>
                    <div
                        class="error-notification"
                        data-se="error-notification"
                        style="display: none"
                    >
                        <div class="alert alert-danger fade show" role="alert"></div>
                    </div>
                    <form id="loginform">
                        <div class="form-group">
                            <label for="username">Email or username:</label>
                            <input
                                type="text"
                                class="form-control my-1"
                                id="username"
                                name="username"
                                data-se="username"
                                autofocus
                            />
                            <label for="password">Password:</label>
                            <input
                                type="password"
                                class="form-control my-1"
                                id="password"
                                name="password"
                                data-se="password"
                            />
                        </div>
                        <input
                            type="submit"
                            name="submit"
                            class="btn btn-primary"
                            id="submit"
                            data-se="submit"
                        />
                    </form>
                </div>
            </div>
        </div>
    );
};

const script = () => {
    const vscode = acquireVsCodeApi();

    const form = document.getElementById("loginform");
    form.addEventListener("submit", onSubmit);
    function onSubmit(event) {
        console.log(event);
        const usernameField = form.elements.username.value;
        const passwordField = form.elements.password.value;
        const submitButton = form.elements.submit;
        submitButton.disabled = true;
        vscode.postMessage({
            type: "login",
            username: usernameField,
            password: passwordField,
        });
        event.preventDefault();
    }

    window.addEventListener("message", function (event) {
        for (let i = 0; i < event.data.length; i++) {
            /**@type {import("../types").WebviewMessage} */
            const message = event.data[i];
            switch (message.command) {
                case "loginError": {
                    const notification = document.querySelector("div.error-notification");
                    const alert = notification.querySelector("div.alert");
                    const submitButton = document.getElementById("submit");
                    submitButton.disabled = false;
                    alert.innerHTML = message.error;
                    notification.style.display = "block";
                    setTimeout(() => {
                        notification.style.display = "none";
                    }, 7500);
                    break;
                }
                default:
                    console.log("Unsupported command", message.command);
            }
        }
    });
};

export { component, script };
