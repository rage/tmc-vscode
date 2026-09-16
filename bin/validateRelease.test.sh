#!/bin/bash
# Pins the two version checks in bin/validateRelease.sh. Both shipped wrong: the
# tag pattern rejected 'v3.5.10' while accepting 'v1.2.31.2.3', and the
# package.json comparison accepted '3.5.30' for tag '3.5.3'.
set -uo pipefail

source "$(dirname "$0")/validateRelease.sh"

failures=0

# Expected version, or "-" for a tag that must be rejected.
checkTag() {
    local actual
    actual=$(releaseVersionFromTag "$1") || actual="-"
    if [[ "$actual" != "$2" ]]
    then
        echo "FAIL: releaseVersionFromTag '$1' gave '$actual', expected '$2'"
        failures=$((failures + 1))
    fi
}

while read -r tag expected
do
    checkTag "$tag" "$expected"
done <<'TAGS'
v3.5.3 3.5.3
v3.5.10 3.5.10
v3.10.0 3.10.0
v3.5.3-prerelease 3.5.3
v1.2.31.2.3 -
v3.5 -
3.5.3 -
TAGS

checkMatch() {
    local actual=match
    packageVersionMatchesTag "$1" "$2" || actual=mismatch
    if [[ "$actual" != "$3" ]]
    then
        echo "FAIL: packageVersionMatchesTag '$1' '$2' gave '$actual', expected '$3'"
        failures=$((failures + 1))
    fi
}

while read -r packageVersion tagVersion expected
do
    checkMatch "$packageVersion" "$tagVersion" "$expected"
done <<'VERSIONS'
3.5.3 3.5.3 match
3.5.30 3.5.3 mismatch
3.5.3 3.5.30 mismatch
VERSIONS

if [[ $failures != 0 ]]
then
    echo "$failures release-validation case(s) failed"
    exit 1
fi

echo "All release-validation cases passed"
