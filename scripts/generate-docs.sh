#!/bin/bash
# This script will generate documentation for the current version


VERSION="2.3.1a" #`python3 -c "import json; f = open('./package.json', 'r'); v = json.loads(f.read())['version']; f.close(); print(v)"`

rm -R .typedoc

# Ensure we fail if any of these commands fail
set -e

yarn gendoc

git checkout gh-pages
mv .typedoc/ $VERSION/
sed "6i\n<li><a href=\"$VERSION/index.html\">$VERSION</a></li>" index.html > index.html.new
rm index.html
mv index.html.new index.html

git add "$VERSION/"
git add index.html
# git commit -m "Add documentation for $VERSION"
# git push