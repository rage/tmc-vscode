#!/bin/bash

exitCode=0

if [[ ! $1 =~ ^[v]([0-9]+\.[0-9]+\.[0-9])+(-prerelease)?$ ]]
then
    echo "Error: Input '${1}' did not match the format 'vX.Y.Z[-prerelease]'"
    exitCode=1
fi

# Version in package.json must match with tag version
tagVersion=${BASH_REMATCH[1]}
packageVersion=$(grep -Eo '^    "version": ".+$' package.json | cut -d\" -f4)
if [[ ! $packageVersion =~ $tagVersion ]]
then
    echo "Error: The version in package.json '${packageVersion}' doesn't match with the tag '${tagVersion}'."
    exitCode=1
fi

# Make sure that the package-lock.json version also matches
packageLockVersion=$(grep -Eo '"version":.+$' package-lock.json)
if [[ ! $packageLockVersion =~ '"version": "'$tagVersion'",' ]]
then
    echo "Error: The version in package-lock.json '${packageVersion}' doesn't match with the tag '${tagVersion}'. Run 'npm i --package-lock-only'}"
    exitCode=1
fi

# Changelog must have entry matching [X.Y.Z] - YYYY-MM-DD
# Count the number of matches
changelogEntry=$(grep -Ec "\[$tagVersion\] - [0-9]{4}(-[0-9]{2}){2}$" CHANGELOG.md)
if [[ $changelogEntry != 1 ]]
then
    echo "Error: Version entry for '${tagVersion}' in CHANGELOG.md is either missing or not formatted properly."
    exitCode=1
fi

# Welcome panel must have entry matching <h3>[X.Y.Z]</h3>
# Count the number of matches
changelogEntry=$(grep -Ec "<h3>$tagVersion - [0-9]{4}(-[0-9]{2}){2}</h3>" webview-ui/src/panels/Welcome.svelte)
if [[ $changelogEntry != 1 ]]
then
    echo "Error: Version entry for '${tagVersion}' in the Welcome panel changelog (./webview-ui/src/panels/Welcome.svelte) is either missing or not formatted properly."
    exitCode=1
fi

# All configured Langs versions should exist on the download server.

if ! node ./bin/verifyThatLangsBuildsExist.js;
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

exit $exitCode
