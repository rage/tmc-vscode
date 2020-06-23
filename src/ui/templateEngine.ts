import * as fs from "fs";
import * as handlebars from "handlebars";
import * as path from "path";
import * as vscode from "vscode";

import { CourseDetails, Webview } from "./templates";
import { SubmissionResultReport, TmcLangsTestResult } from "../api/types";
import Resources from "../config/resources";
import { getProgressBar, numbersToString } from "../utils/";
import { TemplateData } from "./types";

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
            (
                status: string,
                logs: { stdout: number[]; stderr: number[] },
                tmcLogs?: { stdout: string; stderr: string },
            ) => {
                // Java langs 'run tests' returns: PASSED, TESTS_FAILED; COMPILE_FAILED and own logs
                // Python langs 'run tests' returns: PASSED, TESTS_FAILED, but not COMPILE_FAILED
                // 'tmcLogs' are the tmc-langs.jar generated stdout/stderr
                // 'logs' are the logs returned within TmcLangsTestResults type (if any)
                if (tmcLogs?.stdout && status !== "COMPILE_FAILED") {
                    return `<h1>0 TESTS RUN, SEE LOGS FOR INFO</h1><h2>stdout:</h2><pre>${tmcLogs.stdout}</pre><h2>stderr:</h2><pre>${tmcLogs.stderr}</pre>`;
                }

                if (status === "PASSED") {
                    return "<h1 class='passed-header'>PASSED</h1><input type='button' value='Submit to server' class='btn btn-primary' onclick='submitToServer()' />";
                } else if (status === "TESTS_FAILED") {
                    const collapsed = `<button id='collapsible' class="collapsible">Need help?</button>
                                    <div id='content-collapsible' style="height: auto;" class="content-collapsible">`;
                    const pasteLinkHTML = `<p id="showPasteLink" style="display: none;"><input style='width: 65%!important;' type="text" value="" id="copyPasteLink">
                                        <button class='btn btn-primary' onclick="copyText()">Copy text</button><span class='ml-1' id="copied"></span></p>`;
                    return `<h1>TESTS FAILED</h1><input type='button' value='Send solution to server' class='btn btn-primary mb-2' onclick='submitToServer()' />
                    ${collapsed}
                        <h5>Submit to TMC Paste</h5>
                        <p>You can submit your code to TMC Paste and share the link to the course discussion channel and ask for help.</p>
                        ${pasteLinkHTML}
                        <input type='button' value='Submit to TMC Paste' class='btn btn-primary' onclick='sendToPaste()' />
                    </div>`;
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
            const miniSpinner = `<div class="spinner-border spinner-border-sm" role="status">
                                    <span class="sr-only">Loading...</span>
                                </div>`;
            if (status === "created") {
                percentDone = 30;
                return `${getProgressBar(percentDone)}
                        <div>&#10004; Submission received.</div>
                        <div>${miniSpinner} Waiting for it to be processed.</div>`;
            } else if (status === "sending_to_sandbox") {
                percentDone = 45;
                return `${getProgressBar(percentDone)}
                        <div>&#10004; Submission received.</div>
                        <div>${miniSpinner} Submission queued for processing.</div>`;
            } else if (status === "processing_on_sandbox") {
                percentDone = 75;
                return `${getProgressBar(percentDone)}
                        <div>&#10004; Submission received.</div>
                        <div>&#10004; Submission in queue for processing.</div>
                        <div>${miniSpinner} Testing submission.</div>`;
            } else {
                return `${getProgressBar(percentDone)}
                        <div>${miniSpinner} Submission sent to server.</div>`;
            }
        });

        handlebars.registerHelper(
            "show_test_results",
            (testResults: TmcLangsTestResult[], showAll: boolean) => {
                if (!testResults) {
                    return;
                }
                if (!showAll) {
                    const first = testResults.filter((test) => !test.successful);
                    if (first.length === 0) {
                        return undefined;
                    }
                    return new handlebars.SafeString(`<div class="row failed my-2 mx-0">
                            <div class="row m-0">
                                <div class="col-md-1 failed-header">
                                    FAIL:
                                </div>
                                <div class="col-md">
                                    <span>${first[0].name}</span>
                                </div>
                            </div>
                            <div class="row m-0">
                                <div class="col">
                                    <pre>${first[0].message}</pre>
                                </div>
                            </div>
                        </div>`);
                }
                const divs: string[] = [];
                for (const test of testResults) {
                    const classStyle = test.successful ? "passed" : "failed";
                    divs.push(`<div class="row ${classStyle} my-2 mx-0">
                                <div class="row m-0">
                                    <div class="col-md-1 ${classStyle}-header">
                                        ${test.successful ? "PASS:" : "FAIL:"}
                                    </div>
                                    <div class="col-md">
                                        <span>${test.name}</span>
                                    </div>
                                </div>
                                <div class="row m-0">
                                    <div class="col">
                                        <pre>${test.message}</pre>
                                    </div>
                                </div>
                            </div>`);
                }
                return new handlebars.SafeString(divs.join(""));
            },
        );

        handlebars.registerHelper("collect", (...properties) => {
            return properties;
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
                            <input
                                data-questionID="${question.id}"
                                type="range" class="custom-range" min="${question.lower - 1}"
                                max="${question.upper}" step="1" value="${question.lower - 1}"
                                oninput='showValue(this, "text-id-${question.id}")' />
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
     * @param name Name of the template file to user
     * @param data Must contain all the variables used in the template
     *
     * @returns The HTML document as a string
     */
    public async getTemplate(webview: vscode.Webview, templateData: TemplateData): Promise<string> {
        const cspBlob = `<meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; img-src https:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'unsafe-inline';" />`;
        const cssBlob = this.cssBlob;

        if (templateData.templateName === "course-details") {
            return Webview.render({
                children: CourseDetails.component(templateData),
                cssBlob,
                cspSource: webview.cspSource,
                script: CourseDetails.script,
            });
        }

        const name = templateData.templateName;
        const p = path.join(this.htmlPath, `${name}.html`);
        let template: HandlebarsTemplateDelegate<unknown>;
        const cacheResult = this.cache.get(name);
        if (cacheResult) {
            template = cacheResult;
        } else {
            template = handlebars.compile(fs.readFileSync(p, "utf8"));
        }

        return template({ ...templateData, cspBlob, cssBlob });
    }
}
