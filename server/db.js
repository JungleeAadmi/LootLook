const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Connect to the database file created in the setup script
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
        // Create Items Table
        db.run(`CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT NOT NULL,
            name TEXT,
            image_url TEXT,
            current_price REAL,
            target_price REAL,
            currency TEXT DEFAULT '$',
            retention_days INTEGER DEFAULT 30,
            last_checked TEXT
        )`);

        // Create Price History Table
        db.run(`CREATE TABLE IF NOT EXISTS prices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            item_id INTEGER,
            price REAL,
            date TEXT,
            FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE CASCADE
        )`);
    });
}

module.exports = db;
