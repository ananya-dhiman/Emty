import fs from 'fs';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const NODE_VERSION = 'v20.11.0';

// Tauri targets mapped to officially released Node.js distribution binaries
// By default we map to Windows x64. If you deploy to Mac/Linux, add them here.
const targets = [
  { tauri: 'x86_64-pc-windows-msvc', node: 'win-x64/node.exe', ext: '.exe' },
  // { tauri: 'aarch64-apple-darwin', node: 'darwin-arm64/node', ext: '' },
  // { tauri: 'x86_64-apple-darwin', node: 'darwin-x64/node', ext: '' },
  // { tauri: 'x86_64-unknown-linux-gnu', node: 'linux-x64/node', ext: '' }
];

const destDir = path.resolve(__dirname, '../src-tauri/binaries');

if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

async function download(url, dest) {
  return new Promise((resolve, reject) => {
    logger(`Downloading ${url}...`);
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        return download(response.headers.location, dest).then(resolve).catch(reject);
      }
      
      if (response.statusCode !== 200) {
        return reject(new Error(`Failed to download: ${response.statusCode}`));
      }

      response.pipe(file);
      file.on('finish', () => {
        file.close();
        // Give execution permissions on unix
        if (!dest.endsWith('.exe')) fs.chmodSync(dest, 0o755);
        logger(`Saved to ${dest}`);
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

function logger(msg) {
  console.log(`[node-sidecar] ${msg}`);
}

async function main() {
  for (const { tauri, node, ext } of targets) {
    const fileName = `node-${tauri}${ext}`;
    const destPath = path.join(destDir, fileName);

    if (fs.existsSync(destPath)) {
      logger(`Skipping ${fileName}, already exists`);
      continue;
    }

    const url = `https://nodejs.org/dist/${NODE_VERSION}/${node}`;
    try {
      await download(url, destPath);
    } catch (e) {
      console.error(`[node-sidecar] Error downloading ${url}:`, e);
      process.exit(1);
    }
  }
}

main();
