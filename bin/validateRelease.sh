#!/bin/bash
# Validates a release tag against everything that has to agree with it before
# bin/publishRelease.sh pushes it. Run from the repository root.
#
# bin/validateRelease.test.sh sources this file to exercise the two version
# helpers, so sourcing it must not validate anything.

# Echoes the X.Y.Z a `vX.Y.Z[-prerelease]` tag carries; fails on any other shape.
releaseVersionFromTag() {
    [[ $1 =~ ^v([0-9]+\.[0-9]+\.[0-9]+)(-prerelease)?$ ]] || return 1
    printf '%s\n' "${BASH_REMATCH[1]}"
}

# Succeeds only on an exact match: package version '3.5.30' does not satisfy tag
# version '3.5.3'.
packageVersionMatchesTag() {
    [[ "$1" == "$2" ]]
}

validateRelease() {
    local tag=$1
    local tagVersion
    if ! tagVersion=$(releaseVersionFromTag "$tag")
    then
        echo "Error: Input '${tag}' did not match the format 'vX.Y.Z[-prerelease]'"
        echo "Failed to validate release"
        return 1
    fi

    local exitCode=0

    local packageVersion
    packageVersion=$(node -p "require('./package.json').version")
    if ! packageVersionMatchesTag "$packageVersion" "$tagVersion"
    then
        echo "Error: The version in package.json '${packageVersion}' doesn't match with the tag '${tagVersion}'."
        exitCode=1
    fi

    local changelogEntry
    changelogEntry=$(grep -Ec "\[$tagVersion\] - [0-9]{4}(-[0-9]{2}){2}$" CHANGELOG.md)
    if [[ $changelogEntry != 1 ]]
    then
        echo "Error: Version entry for '${tagVersion}' in CHANGELOG.md is either missing or not formatted properly."
        exitCode=1
    fi

    local welcomeEntry
    welcomeEntry=$(grep -Ec "<h3>$tagVersion - [0-9]{4}(-[0-9]{2}){2}</h3>" webview-ui/src/panels/Welcome.svelte)
    if [[ $welcomeEntry != 1 ]]
    then
        echo "Error: Version entry for '${tagVersion}' in the Welcome panel changelog (./webview-ui/src/panels/Welcome.svelte) is either missing or not formatted properly."
        exitCode=1
    fi

    if ! node --import tsx ./bin/verifyThatLangsBuildsExist.ts
    then
        echo "Error: Failed to verify that all Langs builds exist."
        exitCode=1
    fi

    if [ $exitCode = 0 ]
    then
        echo "Validated release successfully"
    else
        echo "Failed to validate release"
    fi

    return $exitCode
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]
then
    validateRelease "$1"
    exit $?
fi
