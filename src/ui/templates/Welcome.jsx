/*eslint-env browser*/

// Required for compilation, even if not referenced
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const createElement = require("./templateUtils").createElement;

/**
 * @param {import("./Welcome").WelcomeProps} props
 */
function component(props) {
    const { version } = props;

    return (
        <div class="w-100">
            <div class="container pt-0">
                <h1>Welcome to using TMC-VSCode version {version}!</h1>

                <p>Lirum larum ad astra</p>
            </div>
        </div>
    );
}

/**
 * @param {import("./Welcome").WelcomeProps} props
 */
function render(props) {
    return component(props).toString();
}

function script() {
    // no op
}

export { component, render, script };
