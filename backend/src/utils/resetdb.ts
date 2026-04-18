import fs from "fs";
import path from "path";

const dbFiles = ["local.db", "local.db-wal", "local.db-shm"];

dbFiles.forEach((file) => {
  const filePath = path.join(process.cwd(), file);

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    console.log(`Deleted: ${file}`);
  } else {
    console.log(`Not found: ${file}`);
  }
});

console.log("✅ Database reset complete");