import { By, WebElement, WebView } from "vscode-extension-tester";

/**
 * Fills out the login form assuming that the user already is on the login page.
 * @returns submit button on provided webview.
 */
const fillLoginForm = async (
    webview: WebView,
    username: string,
    password: string,
): Promise<WebElement> => {
    const usernameField = await webview.findWebElement(By.css("input[data-se='username']"));
    await usernameField.clear();
    await usernameField.sendKeys(username);

    const passwordField = await webview.findWebElement(By.css("input[data-se='password']"));
    await passwordField.clear();
    await passwordField.sendKeys(password);

    return await webview.findWebElement(By.css("[data-se='submit']"));
};

export { fillLoginForm };
