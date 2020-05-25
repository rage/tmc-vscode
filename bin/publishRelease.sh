#!/bin/bash

version=$1

./bin/validateRelease.sh $version
err=$?
if [ $err != 0 ]
then
    echo Some validation checks failed.
    exit $err
fi

if [ $(git branch --show-current) != master ] 
then
    echo You must run this command from the master branch.
    exit 1
fi

git log -1

read -p "Make release $version based on the above commit? (y/N) " confirm
shopt -s nocasematch
if [[ ! $confirm =~ ^(y|yes)$ ]]
then
    echo Release creation was aborted.
    exit 1
fi

tagMessage="Version $(echo $version | cut -d'v' -f 2)"
git tag -a "$version" -m "$tagMessage"
err=$?
if [ $err != 0 ]
then
    echo The tag already exists.
    exit $err
fi

git push origin $version
err=$?
if [ $err != 0 ]
then
    echo Pushing the tag failed.
    exit $err
fi

echo New release tag pushed, please check CI results to verify that publish was a success.
exit $err
