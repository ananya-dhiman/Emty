import Database from "better-sqlite3";
import path from "path";

const dbPath = path.join(process.cwd(), "local.db");
const db = new Database(dbPath);

try {
    const rows = db.prepare("SELECT * FROM sync_checkpoints").all();
    console.log(JSON.stringify(rows, null, 2));
} catch (error) {
    console.error("Error querying database:", error);
} finally {
    db.close();
}
