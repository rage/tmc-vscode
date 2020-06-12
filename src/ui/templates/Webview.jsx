/*eslint-env browser*/

// Required for compilation, even if not referenced
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const createElement = require("./templateUtils").createElement;

function component(webviewProps) {
    const { cspSource, cssBlob, children } = webviewProps;

    return (
        <html>
            <head>
                <meta
                    http-equiv="Content-Security-Policy"
                    content={`default-src 'none'; img-src https:; style-src ${cspSource} 'unsafe-inline'; script-src 'unsafe-inline';`}
                />
                <meta charset="UTF-8" />
                <style>{cssBlob}</style>
            </head>
            <body id="body" class="p-0">
                {children}
            </body>
        </html>
    );
}

function render(webviewProps) {
    return component(webviewProps).toString();
}

export { component, render };
