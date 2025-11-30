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
        // 1. USERS TABLE (New)
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT,
            created_at TEXT
        )`);

        // 2. ITEMS TABLE (Updated with user_id)
        db.run(`CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            url TEXT NOT NULL,
            name TEXT,
            image_url TEXT,
            screenshot_path TEXT,
            current_price REAL,
            previous_price REAL DEFAULT 0,
            currency TEXT DEFAULT '$',
            retention_days INTEGER DEFAULT 30,
            last_checked TEXT,
            date_added TEXT,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )`);

        // 3. PRICE HISTORY
        db.run(`CREATE TABLE IF NOT EXISTS prices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            item_id INTEGER,
            price REAL,
            date TEXT,
            FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE CASCADE
        )`);

        // 4. MIGRATIONS
        db.all("PRAGMA table_info(items)", (err, columns) => {
            if (err) return;
            const names = columns.map(c => c.name);
            if (!names.includes('user_id')) {
                console.log("Migrating: Adding user_id column...");
                // Default existing items to user 1 (Admin)
                db.run("ALTER TABLE items ADD COLUMN user_id INTEGER DEFAULT 1");
            }
            if (!names.includes('previous_price')) db.run("ALTER TABLE items ADD COLUMN previous_price REAL DEFAULT 0");
            if (!names.includes('date_added')) db.run(`ALTER TABLE items ADD COLUMN date_added TEXT DEFAULT '${new Date().toISOString()}'`);
            if (!names.includes('screenshot_path')) db.run("ALTER TABLE items ADD COLUMN screenshot_path TEXT");
        });
    });
}

module.exports = db;