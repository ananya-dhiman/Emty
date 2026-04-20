import fs from 'fs';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const OLLAMA_VERSION = 'v0.6.2';

// Tauri targets mapped to Ollama release artifacts.
// Ollama releases: https://github.com/ollama/ollama/releases
const targets = [
  {
    tauri: 'x86_64-pc-windows-msvc',
    artifact: 'ollama-windows-amd64.exe',
    ext: '.exe',
  },
  // Uncomment as needed for cross-platform builds:
  // {
  //   tauri: 'aarch64-apple-darwin',
  //   artifact: 'ollama-darwin',
  //   ext: '',
  // },
  // {
  //   tauri: 'x86_64-apple-darwin',
  //   artifact: 'ollama-darwin',
  //   ext: '',
  // },
  // {
  //   tauri: 'x86_64-unknown-linux-gnu',
  //   artifact: 'ollama-linux-amd64',
  //   ext: '',
  // },
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
        // Set executable permissions on Unix
        if (!dest.endsWith('.exe')) {
          try {
            fs.chmodSync(dest, 0o755);
          } catch (e) {
            // Ignore -- Windows does not need this
          }
        }
        log(`Saved to ${dest}`);
        setTimeout(resolve, 500); // Buffer for Windows OS handle release
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
    // Tauri sidecar naming convention: {name}-{target}{ext}
    const fileName = `ollama-${tauri}${ext}`;
    const destPath = path.join(destDir, fileName);

    if (fs.existsSync(destPath)) {
      log(`Skipping ${fileName}, already exists`);
      continue;
    }

    const url = `https://github.com/ollama/ollama/releases/download/${OLLAMA_VERSION}/${artifact}`;

    try {
      await download(url, destPath);
      log(`Successfully downloaded ${fileName}`);
    } catch (e) {
      console.error(`[ollama-sidecar] Error downloading ${url}:`, e.message);
      process.exit(1);
    }
  }

  log('Done');
}

main();
