import * as fs from "fs";
import * as handlebars from "handlebars";
import * as path from "path";
import * as vscode from "vscode";

import Resources from "../config/resources";

export default class TemplateEngine {
    private cssPath: string;
    private htmlPath: string;
    private context: vscode.ExtensionContext;
    private cache: Map<string, HandlebarsTemplateDelegate<any>>;

    constructor(resources: Resources, context: vscode.ExtensionContext) {
        this.cssPath = resources.cssFolder;
        this.htmlPath = resources.htmlFolder;
        this.context = context;
        this.cache = new Map();
        handlebars.registerHelper("resolve_logo_path", (logoPath: string) => {
            return (!logoPath.endsWith("missing.png"))
                ? `https://tmc.mooc.fi${logoPath}`
                : "https://tmc.mooc.fi/logos/small_logo/missing.png";
        });
        handlebars.registerHelper("check_local_status", (arg: string) => {
            if (arg === "PASSED") {
                return "<h1 class='passed-header'>PASSED</h1>";
            } else if (arg === "TESTS_FAILED") {
                return "<h1 class='failed-header'>TESTS FAILED</h1>";
            } else {
                return "<h1>Something went wrong while running the tests</h1>";
            }
        });
        handlebars.registerHelper("check_submission_status", (status: string) => {
            if (status === "created") {
                return "<div>Sandbox created</div>";
            } else if (status === "sending_to_sandbox") {
                return "<div>Sandbox created</div><div>Sending to sandbox</div>";
            } else if (status === "processing_on_sandbox") {
                return "<div>Sandbox created</div><div>Sending to sandbox</div><div>Testing submission</div>";
            }
        });
    }

    /**
     * Creates an HTML document from a template, with a default CSS applied
     *
     * @param extensionContext
     * @param name Name of the template file to user
     * @param data Must contain all the variables used in the template
     *
     * @returns The HTML document as a string
     */
    public async getTemplate(webview: vscode.Webview, name: string, data?: any): Promise<string> {

        const p = path.join(this.htmlPath, `${name}.html`);
        let template: HandlebarsTemplateDelegate<any>;
        const cacheResult = this.cache.get(name);
        if (cacheResult) {
            template = cacheResult;
        } else {
            template = handlebars.compile(fs.readFileSync(p, "utf8"));
        }
        if (!data) {
            data = {};
        }
        data.cssPath = webview.asWebviewUri(vscode.Uri.file(path.join(this.cssPath, "style.css")));
        data.bootstrapPath = webview.asWebviewUri(vscode.Uri.file(path.join(this.cssPath, "bootstrap.min.css")));

        console.log(data);

        return template(data);
    }

}
