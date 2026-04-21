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

  for (const { tauri, artifact, ext } of targets) {
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
      log(`Extracting ${artifact}...`);
      if (!fs.existsSync(extractDir)) {
          fs.mkdirSync(extractDir, { recursive: true });
      }

      // Use native Windows tar to extract the zip (available in > Win10 17063)
      child_process.execSync(`tar -xf "${tempZipPath}" -C "${extractDir}"`, { stdio: 'inherit' });

      // 3. Move the binary into place
      const extractedExePath = path.join(extractDir, 'ollama.exe');
      if (fs.existsSync(extractedExePath)) {
          fs.renameSync(extractedExePath, destPath);
          log(`Moved ollama.exe to ${finalName}`);
      } else {
          // Sometimes it might be nested, let's just do a naive find
          const files = fs.readdirSync(extractDir);
          const exe = files.find(f => f.toLowerCase().endsWith('ollama.exe'));
          if (exe) {
              fs.renameSync(path.join(extractDir, exe), destPath);
              log(`Found and moved ${exe} to ${finalName}`);
          } else {
              throw new Error("Could not find ollama.exe in the extracted archive.");
          }
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
