const path = require('path');
const fs = require('fs');
// eslint-disable-next-line camelcase
const child_process = require('child_process');

async function doPostInstall() {
  try {
    fs.statSync(path.join(__dirname, '../lib/index.js'));
  }
  catch (err) {
    console.log('Building typescript because the package.json main entry points to a non-existent location');
    child_process.exec('npm install typescript');
    child_process.exec('npm run prepare');
  }
}

doPostInstall();
