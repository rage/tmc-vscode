#!/bin/bash

exitCode=0

# Tag must match the version scheme
tagVersion=`echo $1 | cut -d'v' -f 2`
if [[ ! $tagVersion =~ ^[0-9]+.[0-9]+.[0-9]+ ]]
then
    echo "::set-env name=RELEASE_TAG::"$tagVersion
    echo "Error: Version tag must match the format vX.Y.Z."
    exitCode=1
fi

# Version in package.json must match with tag version
packageVersion=`grep -Eo '"version":.+$' package.json`
if [[ ! $packageVersion == '"version": "'$tagVersion'",' ]]
then
    echo "Error: The version in package.json doen't match with the tag."
    exitCode=1
fi

# Changelog must have entry matching [X.Y.Z] - YYY-MM-DD
# Count the number of matches
changelogEntry=`grep -Ec "\["$tagVersion"\] - [0-9]{4}(-[0-9]{2}){2}$" CHANGELOG.md`
if [[ $changelogEntry != 1 ]]
then
    echo "Error: Version entry in CHANGELOG.md either missing or not formated properly."
    exitCode=1
fi

exit $exitCode
