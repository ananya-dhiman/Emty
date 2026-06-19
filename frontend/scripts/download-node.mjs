import fs from 'fs';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import child_process from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const NODE_VERSION = 'v20.11.0';

// Tauri targets mapped to officially released Node.js distribution binaries
// By default we map to Windows x64. If you deploy to Mac/Linux, add them here.
const targets = [
  { tauri: 'x86_64-pc-windows-msvc', node: 'win-x64/node.exe', ext: '.exe' },
  { tauri: 'aarch64-apple-darwin', node: 'node-v20.11.0-darwin-arm64.tar.gz', ext: '', isTar: true },
  // { tauri: 'x86_64-apple-darwin', node: 'darwin-x64/node', ext: '' },
  // { tauri: 'x86_64-unknown-linux-gnu', node: 'linux-x64/node', ext: '' }
].filter(t => {
  if (process.platform === 'win32') return t.tauri.includes('windows');
  if (process.platform === 'darwin') return t.tauri.includes('darwin');
  if (process.platform === 'linux') return t.tauri.includes('linux');
  return false;
});

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
        file.close((err) => {
          if (err) {
            reject(err);
            return;
          }
          // Give execution permissions on unix
          if (!dest.endsWith('.exe')) {
            try { fs.chmodSync(dest, 0o755); } catch(e){}
          }
          logger(`Saved to ${dest}`);
          setTimeout(resolve, 500); // 500ms buffer for Windows OS handle release
        });
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
  for (const { tauri, node, ext, isTar } of targets) {
    const fileName = `node-${tauri}${ext}`;
    const destPath = path.join(destDir, fileName);

    if (fs.existsSync(destPath)) {
      logger(`Skipping ${fileName}, already exists`);
      continue;
    }

    const url = `https://nodejs.org/dist/${NODE_VERSION}/${node}`;
    try {
      if (isTar) {
        const tempTarPath = path.join(destDir, `temp-${tauri}.tar.gz`);
        const extractDir = path.join(destDir, `temp-${tauri}`);
        
        await download(url, tempTarPath);
        
        logger(`Extracting ${tempTarPath}...`);
        if (!fs.existsSync(extractDir)) {
          fs.mkdirSync(extractDir, { recursive: true });
        }
        child_process.execSync(`tar -xf "${tempTarPath}" -C "${extractDir}"`, { stdio: 'inherit' });
        
        const extractedFolders = fs.readdirSync(extractDir);
        const nodeFolder = extractedFolders.find(f => f.includes('node-v'));
        const extractedNodePath = path.join(extractDir, nodeFolder, 'bin', 'node');
        
        if (fs.existsSync(extractedNodePath)) {
            fs.renameSync(extractedNodePath, destPath);
            fs.chmodSync(destPath, 0o755);
            logger(`Saved binary to ${destPath}`);
        } else {
            throw new Error("Could not find node binary in the extracted archive.");
        }
        
        fs.unlinkSync(tempTarPath);
        fs.rmSync(extractDir, { recursive: true, force: true });
      } else {
        await download(url, destPath);
      }
    } catch (e) {
      console.error(`[node-sidecar] Error downloading ${url}:`, e);
      process.exit(1);
    }
  }
}

main();
