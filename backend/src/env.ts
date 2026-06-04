import dotenv from "dotenv";
import path from "path";

// Load environment variables immediately upon import
dotenv.config({ path: path.join(__dirname, "../.env") });
