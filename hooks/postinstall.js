const path = require('path');
const fs = require('fs');
// eslint-disable-next-line camelcase
const child_process = require('child_process');
const package = require('../package.json');

const PROJECT_ROOT = path.join(__dirname, '../');

async function doPostInstall() {
  const mainEntry = path.join(PROJECT_ROOT, package.main);
  try {
    fs.statSync(mainEntry);
  }
  catch (err) {
    // eslint-disable-next-line max-len
    console.log(`matrix-appservice-bridge: Building TypeScript because the package.json main entry (${mainEntry}) points to a non-existent location.`);

    child_process.exec('npm install typescript', {
      cwd: PROJECT_ROOT
    });
    child_process.exec('npm run prepare', {
      cwd: PROJECT_ROOT
    });
  }
}

doPostInstall();
