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
        // 1. Create Items Table (if not exists)
        db.run(`CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT NOT NULL,
            name TEXT,
            image_url TEXT,
            current_price REAL,
            currency TEXT DEFAULT '$',
            retention_days INTEGER DEFAULT 30,
            last_checked TEXT
        )`);

        // 2. Create Price History Table
        db.run(`CREATE TABLE IF NOT EXISTS prices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            item_id INTEGER,
            price REAL,
            date TEXT,
            FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE CASCADE
        )`);

        // 3. MIGRATION: Add 'previous_price' column if it doesn't exist
        // This allows us to track trends (Green/Red colors)
        db.all("PRAGMA table_info(items)", (err, columns) => {
            if (err) return;
            const hasPrevPrice = columns.some(c => c.name === 'previous_price');
            if (!hasPrevPrice) {
                console.log("Migrating Database: Adding previous_price column...");
                db.run("ALTER TABLE items ADD COLUMN previous_price REAL DEFAULT 0");
            }
        });
    });
}

module.exports = db;