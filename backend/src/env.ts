import dotenv from "dotenv";
import path from "path";
import fs from "fs";

// Load environment variables immediately upon import
const prodPath = path.join(__dirname, ".env");
const devPath = path.join(__dirname, "../.env");

if (fs.existsSync(prodPath)) {
    dotenv.config({ path: prodPath });
} else {
    dotenv.config({ path: devPath });
}
