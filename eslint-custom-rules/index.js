/* eslint-disable i18next/no-literal-string */
module.exports = {
    rules: {
        "ban-ts-ignore-without-comment": {
            meta: {
                type: "problem",
                docs: {
                    description:
                        'Bans "// @ts-ignore" comments from being used if no comment is specified',
                    category: "Best Practices",
                    recommended: "error",
                },
                schema: [],
                messages: {
                    tsIgnoreWithoutCommentComment:
                        'Do not use "// @ts-ignore" comments because they suppress compilation errors. If you want to use one, add a comment after it, like // @ts-ignore: this is needed because x.',
                },
            },
            create: function (context) {
                const tsIgnoreRegExp = /^\/*\s*@ts-ignore(?!:.*)/;
                const sourceCode = context.getSourceCode();

                return {
                    Program() {
                        const comments = sourceCode.getAllComments();

                        comments.forEach((comment) => {
                            if (comment.type !== "Line") {
                                return;
                            }
                            if (tsIgnoreRegExp.test(comment.value)) {
                                context.report({
                                    node: comment,
                                    messageId: "tsIgnoreWithoutCommentComment",
                                });
                            }
                        });
                    },
                };
            },
        },
    },
};
