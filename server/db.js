const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, '../database/lootlook.db');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database ' + dbPath, err.message);
    } else {
        console.log('Connected to the SQLite database.');
        initDb();
    }
});

function initDb() {
    db.serialize(() => {
        // 1. Create Items Table
        db.run(`CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT NOT NULL,
            name TEXT,
            image_url TEXT,
            current_price REAL,
            previous_price REAL DEFAULT 0,
            currency TEXT DEFAULT '$',
            retention_days INTEGER DEFAULT 30,
            last_checked TEXT,
            date_added TEXT
        )`);

        // 2. Create Price History Table
        db.run(`CREATE TABLE IF NOT EXISTS prices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            item_id INTEGER,
            price REAL,
            date TEXT,
            FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE CASCADE
        )`);

        // 3. MIGRATIONS (Auto-update old databases)
        db.all("PRAGMA table_info(items)", (err, columns) => {
            if (err) return;
            const colNames = columns.map(c => c.name);
            
            if (!colNames.includes('previous_price')) {
                console.log("Migrating: Adding previous_price...");
                db.run("ALTER TABLE items ADD COLUMN previous_price REAL DEFAULT 0");
            }
            if (!colNames.includes('date_added')) {
                console.log("Migrating: Adding date_added...");
                // Default to current time for existing items
                db.run(`ALTER TABLE items ADD COLUMN date_added TEXT DEFAULT '${new Date().toISOString()}'`);
            }
        });
    });
}

module.exports = db;