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
        // 1. USERS TABLE (Updated with profile fields)
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT,
            name TEXT,
            gender TEXT,
            age INTEGER,
            created_at TEXT
        )`);

        // 2. ITEMS TABLE
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
            shared_by TEXT,
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

        // MIGRATIONS (Check for missing columns)
        db.all("PRAGMA table_info(users)", (err, columns) => {
            if (err) return;
            const names = columns.map(c => c.name);
            if (!names.includes('name')) db.run("ALTER TABLE users ADD COLUMN name TEXT");
            if (!names.includes('gender')) db.run("ALTER TABLE users ADD COLUMN gender TEXT");
            if (!names.includes('age')) db.run("ALTER TABLE users ADD COLUMN age INTEGER");
        });
        
        // Items migrations
        db.all("PRAGMA table_info(items)", (err, columns) => {
            if (err) return;
            const names = columns.map(c => c.name);
            if (!names.includes('previous_price')) db.run("ALTER TABLE items ADD COLUMN previous_price REAL DEFAULT 0");
            if (!names.includes('date_added')) db.run(`ALTER TABLE items ADD COLUMN date_added TEXT DEFAULT '${new Date().toISOString()}'`);
            if (!names.includes('screenshot_path')) db.run("ALTER TABLE items ADD COLUMN screenshot_path TEXT");
            if (!names.includes('user_id')) db.run("ALTER TABLE items ADD COLUMN user_id INTEGER DEFAULT 1");
            if (!names.includes('shared_by')) db.run("ALTER TABLE items ADD COLUMN shared_by TEXT");
        });
    });
}

module.exports = db;