const fs = require('fs');
const version = process.argv[2];

if (!version) {
    throw Error('No version given');
}

output = "";

for (const line of fs.readFileSync('index.html', 'utf-8').split('\n')) {
    output += line + '\n';
    if (line === "<ul>") {
        output+= `    <li><a href="${version}/index.html">${version}</a></li>\n`;
    }
}

console.log(`Updating index.html with new version: ${version}`);
fs.writeFileSync('index.html', output);
