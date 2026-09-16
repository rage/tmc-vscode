# Provenance-stamp helpers shared by the two vendoring scripts,
# bin/updateLangsSchema.sh and bin/updateLangsOpenapi.sh.
#
# A stamp records the source rev and the sha256 of the vendored file, so CI can
# tell a hand-edit apart from a re-vendor without needing a checkout of the
# source repository.

# sha256 of a file, portable across Linux (sha256sum) and macOS (shasum).
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

# Echoes one member of a stamp file, or the empty string: stamp_field <stamp> <member>.
stamp_field() {
  node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))[process.argv[2]]??''))" "$1" "$2"
}

# Fails unless the vendored file still hashes to what its stamp records:
# verify_stamp <vendored file> <stamp> <re-vendor command>
verify_stamp() {
  local target=$1
  local stamp=$2
  local revendor=$3
  if [ ! -f "$stamp" ]; then
    echo "error: $stamp not found. Run '$revendor' to create it." >&2
    return 1
  fi
  if [ ! -f "$target" ]; then
    echo "error: $target not found." >&2
    return 1
  fi
  local actual
  local expected
  actual="$(sha256_of "$target")"
  expected="$(stamp_field "$stamp" sha256)"
  if [ "$actual" = "$expected" ]; then
    echo "OK: $target sha256 matches the stamp ($expected)"
    return 0
  fi
  echo "STAMP MISMATCH: $target sha256 $actual != stamp $expected" >&2
  echo "The vendored file was hand-edited or the stamp is stale; re-vendor with '$revendor'." >&2
  return 1
}

# `pnpm run <script> -- <arg>` can forward the literal "--" separator as the
# script's first argument; echoes the mode with that separator dropped.
vendor_mode() {
  if [ "${1:-}" = "--" ]; then
    shift
  fi
  printf '%s' "${1:-}"
}
