#!/bin/bash
# This script will run towncrier to generate a changelog entry.

VERSION=`python3 -c "import json; f = open('./package.json', 'r'); v = json.loads(f.read())['version']; f.close(); print(v)"`
TAG="$VERSION"

if [[ "`git branch --show-current`" != "develop" ]]; then
    echo "You must be on the develop branch to run this command."
    exit 1
fi

if [ $(git tag -l "$TAG") ]; then
    echo "Tag $TAG already exists, not continuing."
    exit 1
fi

echo "Drafting a new release"
towncrier build --draft --version $VERSION> draft-release.txt
cat draft-release.txt

read -p "Happy with the changelog? <y/N> " prompt
if [[ $prompt != "y" && $prompt != "Y" && $prompt != "yes" && $prompt != "Yes" ]]
then
  exit 0
fi

echo "Committing version"
towncrier build --version $VERSION
git commit CHANGELOG.md changelog.d/ package.json -m $TAG

echo "Proceeding to generate tags"
cat draft-release.txt | git tag --force -m - -s $TAG
rm draft-release.txt
echo "Generated tag $TAG"

echo "Pushing to origin"
git push origin $TAG
# Push develop too
git push

echo "The CI to generate a release is now running. Check https://github.com/matrix-org/matrix-appservice-bridge/releases and publish the release when it's ready."
