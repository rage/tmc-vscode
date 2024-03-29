//@ts-check

const Mocha = require("mocha");
const path = require("path");

function run() {
    // Create the mocha test
    const mocha = new Mocha({
        ui: "tdd",
        color: true,
    });

    return /** @type {Promise<void>} */ (
        new Promise((c, e) => {
            mocha.addFile(path.resolve(__dirname, "..", "dist", "testBundle.test.js"));

            try {
                // Run the mocha test
                mocha.run((failures) => {
                    if (failures > 0) {
                        e(new Error(`${failures} tests failed.`));
                    } else {
                        c();
                    }
                });
            } catch (err) {
                e(err);
            }
        })
    );
}

exports.run = run;
