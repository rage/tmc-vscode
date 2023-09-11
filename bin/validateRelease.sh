#!/bin/bash

exitCode=0

# Tag must match the tag scheme, GH uses refs/tags/vX.Y.Z as param, thus cut
tag=$(echo "$1" | cut -d'/' -f 3)
if [[ ! $tag =~ ^[v]([0-9]+\.[0-9]+\.[0-9]+(-prerelease)?)$ ]]
then
    echo "Error: Github Tag must match the format vX.Y.Z[-prerelease]"
    exitCode=1
fi

# Version in package.json must match with tag version
tagVersion=${BASH_REMATCH[1]}
packageVersion=$(grep -Eo '"version":.+$' package.json)
if [[ ! $packageVersion =~ '"version": "'$tagVersion'",' ]]
then
    echo "Error: The version in package.json doesn't match with the tag."
    exitCode=1
fi

# Make sure that the package-lock.json version also matches
packageLockVersion=$(grep -Eo '"version":.+$' package-lock.json)
if [[ ! $packageLockVersion =~ '"version": "'$tagVersion'",' ]]
then
    echo "Error: The version in package-lock.json doesn't match with the tag."
    exitCode=1
fi

# Changelog must have entry matching [X.Y.Z] - YYY-MM-DD
# Count the number of matches
changelogEntry=$(grep -Ec "\[""$tagVersion""\] - [0-9]{4}(-[0-9]{2}){2}$" CHANGELOG.md)
if [[ $changelogEntry != 1 ]]
then
    echo "Error: Version entry in CHANGELOG.md either missing or not formated properly."
    exitCode=1
fi

# All configured Langs versions should exist on the download server.
node ./bin/verifyThatLangsBuildsExist.js
if [ $? != 0 ]
then
    echo "Error: Failed to verify that all Langs builds exist."
    exitCode=1
fi

exit $exitCode
