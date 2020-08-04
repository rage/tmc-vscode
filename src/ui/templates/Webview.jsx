/*eslint-env browser*/

// From merge, TODO: Fix
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */

// Required for compilation, even if not referenced
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const createElement = require("./templateUtils").createElement;

function component(webviewProps) {
    const { cspSource, cssBlob, children, script } = webviewProps;

    return (
        <html>
            <head>
                <meta
                    http-equiv="Content-Security-Policy"
                    content={
                        "default-src 'none';" +
                        `img-src ${cspSource} https:;` +
                        `style-src ${cspSource} 'unsafe-inline';` +
                        "script-src 'unsafe-inline';"
                    }
                />
                <meta charset="UTF-8" />
                <style>{cssBlob}</style>
            </head>
            <body id="body" class="p-0">
                {children}
                {script ? (
                    <script>
                        {createElement}
                        {`(${script})();`}
                    </script>
                ) : null}
            </body>
        </html>
    );
}

function render(webviewProps) {
    return component(webviewProps).toString();
}

export { component, render };
