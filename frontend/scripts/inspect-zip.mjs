import AdmZip from 'adm-zip';
import https from 'https';

console.log("Downloading snippet to read headers...");
https.get("https://github.com/ollama/ollama/releases/download/v0.6.2/ollama-windows-amd64.zip", {
  headers: {
    // Only fetch first 1MB to read Central Directory? Wait, zip CD is at the END of the file!
    // Range requests to the end of the file.
  }
}).on('response', (res) => {
    if (res.statusCode === 302) {
        console.log("Redirected to: ", res.headers.location);
    }
});
