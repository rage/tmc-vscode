/**
 * This function is used by the compiling process for transforming JSX elements into strings.
 * As presented in an article by Jared Jones (retrieved 2020-06-09):
 * https://dev.to/jaredkent/faking-react-for-vscode-webviews-2258
 */

function createElement(type, attributes, ...children) {
    const attributeString = Object.entries(attributes || {})
        .map(([attr, value]) => {
            switch (attr) {
                default:
                    return `${attr}="${value}"`;
            }
        })
        .join(" ");
    const childrenString = Array.isArray(children)
        ? children.filter((c) => c !== null).join("")
        : children || "";
    return `<${type} ${attributeString}>${childrenString}</${type}>`;
}

module.exports = createElement;
