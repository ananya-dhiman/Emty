import fs from 'fs';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import child_process from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const OLLAMA_VERSION = 'v0.6.2';

const targets = [
  {
    tauri: 'x86_64-pc-windows-msvc',
    artifact: 'ollama-windows-amd64.zip',
    ext: '.exe',
    isZip: true,
  },
  {
    tauri: 'aarch64-apple-darwin',
    artifact: 'ollama-darwin.tgz',
    ext: '',
    isZip: true,
  },
];

const destDir = path.resolve(__dirname, '../src-tauri/binaries');

if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg) {
  console.log(`[ollama-sidecar] ${msg}`);
}

function followRedirects(url, dest, resolve, reject) {
  https.get(url, (response) => {
    if (response.statusCode === 301 || response.statusCode === 302) {
      const redirectUrl = response.headers.location;
      log(`Redirecting to ${redirectUrl}`);
      return followRedirects(redirectUrl, dest, resolve, reject);
    }

    if (response.statusCode !== 200) {
      return reject(new Error(`HTTP ${response.statusCode} for ${url}`));
    }

    const totalBytes = parseInt(response.headers['content-length'], 10) || 0;
    let downloadedBytes = 0;
    let lastPercent = -1;

    const file = fs.createWriteStream(dest);

    response.on('data', (chunk) => {
      downloadedBytes += chunk.length;
      if (totalBytes > 0) {
        const percent = Math.floor((downloadedBytes / totalBytes) * 100);
        if (percent !== lastPercent && percent % 10 === 0) {
          log(`Progress: ${percent}% (${(downloadedBytes / 1024 / 1024).toFixed(1)} MB)`);
          lastPercent = percent;
        }
      }
    });

    response.pipe(file);

    file.on('finish', () => {
      file.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        log(`Saved to ${dest}`);
        setTimeout(resolve, 500); // Buffer for OS handle release
      });
    });
  }).on('error', (err) => {
    fs.unlink(dest, () => {});
    reject(err);
  });
}

async function download(url, dest) {
  return new Promise((resolve, reject) => {
    log(`Downloading ${url}...`);
    followRedirects(url, dest, resolve, reject);
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log(`Ollama version: ${OLLAMA_VERSION}`);

  for (const { tauri, artifact, ext, isZip } of targets) {
    const finalName = `ollama-${tauri}${ext}`;
    const destPath = path.join(destDir, finalName);
    const tempZipPath = path.join(destDir, artifact);
    const extractDir = path.join(destDir, `temp-${tauri}`);

    if (fs.existsSync(destPath)) {
      log(`Skipping ${finalName}, already exists`);
      continue;
    }

    const url = `https://github.com/ollama/ollama/releases/download/${OLLAMA_VERSION}/${artifact}`;

    try {
      // 1. Download the ZIP archive
      await download(url, tempZipPath);
      log(`Successfully downloaded ${artifact}`);

      // 2. Extract specific executable
      if (isZip) {
          log(`Extracting ${artifact}...`);
          if (!fs.existsSync(extractDir)) {
              fs.mkdirSync(extractDir, { recursive: true });
          }

          // Use native Windows tar to extract the zip/tgz (available in > Win10 17063)
          child_process.execSync(`tar -xf "${tempZipPath}" -C "${extractDir}"`, { stdio: 'inherit' });

          // 3. Move the binary into place
          // The binary might be named ollama.exe (Windows) or just ollama (Mac/Linux)
          // It could also be nested in a subfolder.
          let extractedExePath = null;
          
          function findExe(dir) {
              const items = fs.readdirSync(dir);
              for (const item of items) {
                  const fullPath = path.join(dir, item);
                  const stat = fs.statSync(fullPath);
                  if (stat.isDirectory()) {
                      const found = findExe(fullPath);
                      if (found) return found;
                  } else if (item.toLowerCase() === 'ollama.exe' || item.toLowerCase() === 'ollama') {
                      return fullPath;
                  }
              }
              return null;
          }

          extractedExePath = findExe(extractDir);

          if (extractedExePath) {
              fs.renameSync(extractedExePath, destPath);
              fs.chmodSync(destPath, 0o755); // Make executable on Unix
              log(`Found and moved binary to ${finalName}`);
          } else {
              throw new Error("Could not find ollama binary in the extracted archive.");
          }
      } else {
          fs.renameSync(tempZipPath, destPath);
          fs.chmodSync(destPath, 0o755);
          log(`Moved binary to ${finalName}`);
      }

      // 4. Cleanup
      log(`Cleaning up temporary files...`);
      fs.unlinkSync(tempZipPath);
      fs.rmSync(extractDir, { recursive: true, force: true });
      
      log(`Finished processing ${finalName}`);

    } catch (e) {
      console.error(`[ollama-sidecar] Error processing ${url}:`, e.message);
      // Try to clean up
      if (fs.existsSync(tempZipPath)) fs.unlinkSync(tempZipPath);
      if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true });
      process.exit(1);
    }
  }

  log('Done');
}

main();
