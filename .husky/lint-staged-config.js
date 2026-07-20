// Pre-commit tier: fast, autofix-only, never blocks a commit.
// The failing gates (lint:ci, format:check, typecheck) run in CI.
module.exports = {
  "*.{js,mjs,cjs,jsx,ts,tsx,svelte}": [
    "./bin/oxlint-autofix",
    "oxfmt --no-error-on-unmatched-pattern",
  ],
  "*.{html,json,md,yml,yaml,css}": ["oxfmt --no-error-on-unmatched-pattern"],
}
