import * as fs from "fs";
import * as handlebars from "handlebars";
import * as path from "path";
import * as vscode from "vscode";

import { SubmissionResultReport, TmcLangsTestResult } from "../api/types";
import Resources from "../config/resources";
import { getProgressBar, numbersToString } from "../utils";

export default class TemplateEngine {
    private cssPath: string;
    private htmlPath: string;
    private cache: Map<string, HandlebarsTemplateDelegate<unknown>>;
    private cssBlob: string;

    constructor(resources: Resources) {
        this.cssPath = resources.cssFolder;
        this.htmlPath = resources.htmlFolder;
        this.cache = new Map();
        this.cssBlob =
            fs.readFileSync(path.join(this.cssPath, "bootstrap.min.css"), "utf8") +
            fs.readFileSync(path.join(this.cssPath, "style.css"), "utf8");
        /**
         * Logo path for organizations
         */
        handlebars.registerHelper("resolve_logo_path", (logoPath: string) => {
            return !logoPath.endsWith("missing.png")
                ? `https://tmc.mooc.fi${logoPath}`
                : "https://tmc.mooc.fi/logos/small_logo/missing.png";
        });

        /**
         * Checks the locally runned test status.
         */
        handlebars.registerHelper(
            "check_test_status",
            (status: string, logs: { stdout: number[]; stderr: number[] }) => {
                if (status === "PASSED") {
                    return "<h1 class='passed-header'>PASSED</h1><input type='button' value='Submit to server' class='btn-primary' onclick='submitToServer()' />";
                } else if (status === "TESTS_FAILED") {
                    return "<h1>TESTS FAILED</h1>";
                } else if (status === "COMPILE_FAILED") {
                    return `<h1>COMPILE FAILED</h1><pre>${numbersToString(logs.stdout)}</pre>`;
                } else {
                    return "<h1>Something went seriously wrong while running the tests</h1>";
                }
            },
        );

        /**
         * Submission result show correct heading or compilation error
         */
        handlebars.registerHelper("submission_status", (results: SubmissionResultReport) => {
            if (results.status === "ok" && results.all_tests_passed) {
                return "<h1 class='passed-header'>All tests passed on the server</h1><input type='button' class='btn-primary' value='View model solution' onclick='viewModelSolution()' />";
            } else if (results.status === "fail") {
                return "<h1>Some tests failed on the server</h1>";
            } else if (results.status === "error") {
                return `<h1>Server returned following error:
                        <pre style="font-size: 14px">${results.error}</pre>`;
            }
        });

        /**
         * Progress bar for running tests and submission.
         */
        handlebars.registerHelper("progress_bar", (exercises: TmcLangsTestResult[]) => {
            const length = exercises.length;
            let passedAmount = 0;
            for (const exer of exercises) {
                if (exer.successful) {
                    passedAmount = passedAmount + 1;
                }
            }
            passedAmount = Math.round((passedAmount / length) * 100);
            const notPassed = 100 - passedAmount;
            return `<div class="progress" style="width: 100%">
                        <div class="progress-bar bg-success" role="progressbar" style="width: ${passedAmount}%" aria-valuenow="${passedAmount}" aria-valuemin="0" aria-valuemax="100">
                            ${passedAmount} %
                        </div>
                        <div class="progress-bar bg-danger" role="progressbar" style="width: ${notPassed}%" aria-valuenow="${notPassed}" aria-valuemin="0" aria-valuemax="100">
                            ${passedAmount === 0 ? "0 %" : ""}
                        </div>
                    </div>`;
        });

        /**
         * Returns the progress of submission status from TMC server
         */
        handlebars.registerHelper("check_submission_status", (status: string) => {
            let percentDone = 0;
            if (status === "created") {
                percentDone = 30;
                return `${getProgressBar(percentDone)}
                        <div>&#10004; Submission received. Waiting for it to be processed.</div>`;
            } else if (status === "sending_to_sandbox") {
                percentDone = 45;
                return `${getProgressBar(percentDone)}
                        <div>&#10004; Submission received. Waiting for it to be processed.</div>
                        <div>Submission queued for processing.</div>`;
            } else if (status === "processing_on_sandbox") {
                percentDone = 75;
                return `${getProgressBar(percentDone)}
                        <div>&#10004; Submission received. Waiting for it to be processed.</div>
                        <div>&#10004; Submission in queue for processing.</div>
                        <div>Testing submission.</div>`;
            } else {
                return `${getProgressBar(percentDone)}
                        <div>Submission sent to server.</div>`;
            }
        });

        handlebars.registerHelper(
            "feedback_question",
            (question: {
                id: number;
                kind: string;
                lower?: number;
                upper?: number;
                question: string;
            }) => {
                if (question.kind === "text") {
                    return `<div class="col-md-10">
                                <textarea data-questionID="${question.id}" rows="6" cols="40" class="feedback-textarea"></textarea>
                            </div>`;
                } else if (
                    question.kind === "intrange" &&
                    question.lower !== undefined &&
                    question.upper !== undefined
                ) {
                    return `<div class="col-md-10">
                            <input data-questionID="${
                                question.id
                            }" type="range" class="custom-range" min="${question.lower - 1}"
                                max="${question.upper}" step="1" value="${question.lower -
                        1}" oninput='showValue(this, "text-id-${question.id}")' />
                            </div>
                            <div class="col-md-2">
                                <span class="font-weight-bold" id="text-id-${question.id}">-</span>
                            </div>`;
                } else {
                    return "";
                }
            },
        );
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
    public async getTemplate(
        webview: vscode.Webview,
        name: string,
        data?: { [key: string]: unknown },
    ): Promise<string> {
        const p = path.join(this.htmlPath, `${name}.html`);
        let template: HandlebarsTemplateDelegate<unknown>;
        const cacheResult = this.cache.get(name);
        if (cacheResult) {
            template = cacheResult;
        } else {
            template = handlebars.compile(fs.readFileSync(p, "utf8"));
        }
        if (!data) {
            data = {};
        }
        data.cssBlob = this.cssBlob;

        return template(data);
    }
}
