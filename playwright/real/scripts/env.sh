# Sourced by the CLI-level scripts. CLI state lives per student (E2E_STUDENT, default user) so runs don't share a token family.
E2E="${E2E:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
export B="${E2E_MOOC_ROOT_URL:-http://project-331.local}/api/v0"
REPO="$(cd "$E2E/../../.." && pwd)"
export CLI="${E2E_CLI:-$(ls "$REPO"/backend/cli/tmc-langs-cli-* | grep -v "\.sha256$" | head -n 1)}"
export TMC_LANGS_MOOC_ROOT_URL="${E2E_MOOC_ROOT_URL:-http://project-331.local}"
export TMC_LANGS_MOOC_TRUST_LOCALHOST=1
export TMC_LANGS_TMC_ROOT_URL=http://localhost:4999
export E2E_STUDENT="${E2E_STUDENT:-user}"
CLI_STATE="$E2E/cli-state/$E2E_STUDENT"
export TMC_LANGS_CONFIG_DIR="$CLI_STATE/config"
export PROJECTS="$CLI_STATE/projects"
mkdir -p "$TMC_LANGS_CONFIG_DIR/tmc-vscode_plugin" "$PROJECTS"
[ -f "$TMC_LANGS_CONFIG_DIR/tmc-vscode_plugin/config.toml" ] || echo "projects_dir = \"$PROJECTS\"" >"$TMC_LANGS_CONFIG_DIR/tmc-vscode_plugin/config.toml"
# COURSE, CHAPTER, INSTANCE, PAGE as setup-course.sh last found them.
[ -f "$E2E/ids.env" ] && source "$E2E/ids.env"
true
