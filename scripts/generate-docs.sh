#!/bin/bash
# This script will generate documentation for the current version

# Ensure we fail if any of these commands fail
set -e

VERSION=`/usr/bin/env node -e "console.log(require('./package.json').version)"`

if [[ "$VERSION" =~ ^[0-9]+.[0-9]+.[0-9]+$ ]]; then
    echo "Building documentation for version $VERSION"
else
    echo "Invalid version '$VERSION'"
    exit 1
fi

yarn gendoc

git checkout gh-pages
git pull

mv .typedoc/ $VERSION/
sed "6i\    <li><a href=\"$VERSION/index.html\">$VERSION</a></li>" index.html > index.html.new
rm index.html
mv index.html.new index.html

git add "$VERSION/"
git add index.html
git commit -m "Add documentation for $VERSION"
git push
