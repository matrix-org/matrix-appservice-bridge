const fs = require('fs');
const version = process.argv[2];

if (!version) {
    throw Error('No version given');
}

for (const line of fs.readFileSync('index.html', 'utf-8').split('\n')) {
    console.log(line);
    if (line === "<ul>") {
        console.log (`    <li><a href=${version}/index.html">${version}</a></li>`);
    }
}