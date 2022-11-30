#!/bin/bash
# This script will run towncrier to generate a changelog entry.

VERSION=`python3 -c "import json; f = open('./package.json', 'r'); v = json.loads(f.read())['version']; f.close(); print(v)"`
TAG="$VERSION"

if [ $(git tag -l "$TAG") ]; then
    echo "Tag $TAG exists, not overwriting"
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

echo "The CI to generate a release is now running. Check https://github.com/matrix-org/matrix-appservice-bridge/releases and publish the release when it's ready."
