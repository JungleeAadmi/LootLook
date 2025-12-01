// ... [Keep imports and setup] ...
const express = require('express');
const cors = require('cors');
const path = require('path'); 
const http = require('http'); 
const { Server } = require('socket.io'); 
const db = require('./db');
const { scrapeProduct } = require('./scraper');
const cron = require('node-cron');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Parser } = require('json2csv');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = 3001;
const JWT_SECRET = "lootlook-super-secret-key-change-this"; 

app.use(cors());
app.use(express.json());
app.use('/screenshots', express.static(path.join(__dirname, 'screenshots')));
const screenshotDir = path.join(__dirname, 'screenshots');
if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir);

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    let token = authHeader && authHeader.split(' ')[1];
    if (!token && req.query.token) token = req.query.token;
    if (token == null) return res.sendStatus(401);
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

io.on('connection', (socket) => { });
const broadcastUpdate = () => { io.emit('REFRESH_DATA'); };

function cleanUrl(rawUrl) {
    try {
        if(rawUrl.includes('amzn.in') || rawUrl.includes('dl.flipkart') || rawUrl.includes('sharein')) return rawUrl;
        const urlObj = new URL(rawUrl);
        const paramsToRemove = ['utm_source', 'utm_medium', 'utm_campaign', 'ref', 'ref_', 'tag', 'fbclid', 'gclid'];
        paramsToRemove.forEach(param => urlObj.searchParams.delete(param));
        if (urlObj.hostname.includes('amazon')) {
            const match = urlObj.pathname.match(/\/dp\/([A-Z0-9]{10})/);
            if (match) return `https://${urlObj.hostname}/dp/${match[1]}`;
        }
        return urlObj.toString();
    } catch (e) { return rawUrl; }
}

// --- AUTH ROUTES (Keep as is) ---
app.post('/api/register', async (req, res) => {
    const { username, password, name, gender, age } = req.body;
    if (!username || !password || !name) return res.status(400).json({ error: "Missing fields" });
    const hashedPassword = await bcrypt.hash(password, 10);
    db.run(`INSERT INTO users (username, password, name, gender, age, created_at) VALUES (?, ?, ?, ?, ?, ?)`, 
        [username, hashedPassword, name, gender, age, new Date().toISOString()], 
        function(err) {
            if (err) return res.status(400).json({ error: "Username taken" });
            res.json({ message: "Registered" });
        }
    );
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, user) => {
        if (err || !user) return res.status(400).json({ error: "User not found" });
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) return res.status(403).json({ error: "Invalid password" });
        const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET);
        res.json({ token, username: user.username, name: user.name });
    });
});

app.get('/api/users', authenticateToken, (req, res) => {
    db.all("SELECT id, username, name FROM users WHERE id != ?", [req.user.id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ data: rows });
    });
});

// --- ITEM ROUTES (UPDATED FOR SOFT DELETE) ---

// GET: Only non-deleted items
app.get('/api/items', authenticateToken, (req, res) => {
    const sql = `
        SELECT i.*, 
        (SELECT GROUP_CONCAT(u.username) FROM items shared_copy JOIN users u ON shared_copy.user_id = u.id WHERE shared_copy.original_item_id = i.id AND shared_copy.deleted = 0) as shared_with_names,
        (SELECT GROUP_CONCAT(shared_copy.user_id) FROM items shared_copy WHERE shared_copy.original_item_id = i.id AND shared_copy.deleted = 0) as shared_with_ids
        FROM items i 
        WHERE i.user_id = ? AND i.deleted = 0
        ORDER BY i.id DESC
    `;
    db.all(sql, [req.user.id], (err, rows) => {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ data: rows });
    });
});

// POST: Create new item
app.post('/api/items', authenticateToken, async (req, res) => {
    const { url, retention } = req.body;
    const cleanedUrl = cleanUrl(url);
    const data = await scrapeProduct(cleanedUrl);
    if (!data) return res.status(500).json({ error: "Could not scrape link." });

    const now = new Date().toISOString();
    // Added deleted=0 default
    const sql = `INSERT INTO items (user_id, url, name, image_url, screenshot_path, current_price, previous_price, currency, retention_days, last_checked, date_added, deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`;
    const params = [req.user.id, cleanedUrl, data.title, data.image, data.screenshot, data.price, data.price, data.currency || '$', retention || 30, now, now];

    db.run(sql, params, function(err) {
        if (err) return res.status(400).json({ error: err.message });
        db.run(`INSERT INTO prices (item_id, price, date) VALUES (?, ?, ?)`, [this.lastID, data.price, now]);
        broadcastUpdate();
        res.json({ message: "Item added", id: this.lastID, ...data });
    });
});

// PUT: Edit Item
app.put('/api/items/:id', authenticateToken, (req, res) => {
    const { url, retention } = req.body;
    db.run("UPDATE items SET url = ?, retention_days = ? WHERE id = ? AND user_id = ?", [cleanUrl(url), retention, req.params.id, req.user.id], function(err) {
        if (err) return res.status(400).json({ error: err.message });
        broadcastUpdate();
        res.json({ message: "Updated" });
    });
});

// DELETE: Soft Delete (Set deleted = 1)
app.delete('/api/items/:id', authenticateToken, (req, res) => {
    db.run("UPDATE items SET deleted = 1 WHERE id = ? AND user_id = ?", [req.params.id, req.user.id], (err) => {
        if (err) return res.status(400).json({ error: err.message });
        broadcastUpdate();
        res.json({ message: "Moved to trash" });
    });
});

// RESTORE: Undo Delete (Set deleted = 0)
app.post('/api/items/:id/restore', authenticateToken, (req, res) => {
    db.run("UPDATE items SET deleted = 0 WHERE id = ? AND user_id = ?", [req.params.id, req.user.id], (err) => {
        if (err) return res.status(400).json({ error: err.message });
        broadcastUpdate();
        res.json({ message: "Restored" });
    });
});

// HARD DELETE (Optional: For Janitor or explicit permanent delete)
// Not exposed in UI for now to allow rollback safety

// SHARE Logic
app.post('/api/share', authenticateToken, (req, res) => {
    const { itemId, targetUserId } = req.body;
    const senderName = req.user.username;
    db.get("SELECT * FROM items WHERE id = ? AND user_id = ?", [itemId, req.user.id], (err, item) => {
        if (err || !item) return res.status(404).json({ error: "Item not found" });
        db.get("SELECT id FROM items WHERE original_item_id = ? AND user_id = ?", [itemId, targetUserId], (err, existing) => {
             if (existing) return res.json({ message: "Already shared" });
             const now = new Date().toISOString();
             const sql = `INSERT INTO items (user_id, url, name, image_url, screenshot_path, current_price, previous_price, currency, retention_days, last_checked, date_added, shared_by, shared_on, original_item_id, deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`;
             const params = [targetUserId, item.url, item.name, item.image_url, item.screenshot_path, item.current_price, item.previous_price, item.currency, item.retention_days, item.last_checked, now, senderName, now, itemId];
             db.run(sql, params, function(err) {
                if (err) return res.status(500).json({ error: err.message });
                db.run(`INSERT INTO prices (item_id, price, date) VALUES (?, ?, ?)`, [this.lastID, item.current_price, now]);
                broadcastUpdate();
                res.json({ message: "Shared successfully!" });
             });
        });
    });
});

// UNSHARE Logic (Sets deleted=1 for recipient)
app.post('/api/unshare', authenticateToken, (req, res) => {
    const { itemId, targetUserId } = req.body;
    // Actually hard delete shared copies to "Revoke" access completely, or soft delete?
    // Hard delete implies "I took it back".
    db.run("DELETE FROM items WHERE original_item_id = ? AND user_id = ?", [itemId, targetUserId], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        broadcastUpdate();
        res.json({ message: "Access revoked" });
    });
});

// HISTORY
app.get('/api/history/:id', authenticateToken, (req, res) => {
    db.get("SELECT id FROM items WHERE id = ? AND user_id = ?", [req.params.id, req.user.id], (err, row) => {
        if(!row) return res.status(403).json({ error: "Access Denied" });
        db.all("SELECT * FROM prices WHERE item_id = ? ORDER BY date ASC", [req.params.id], (err, rows) => {
            res.json({ data: rows });
        });
    });
});

// REFRESH (Global)
app.post('/api/refresh/:id', authenticateToken, (req, res) => {
    const id = req.params.id;
    db.get("SELECT url FROM items WHERE id = ?", [id], async (err, originItem) => {
        if (err || !originItem) return res.status(404).json({ error: "Item not found" });
        const freshData = await scrapeProduct(originItem.url);
        if (freshData) {
            const now = new Date().toISOString();
            // Update ALL items with same URL (Global Sync), ignore deleted ones or update them too?
            // Usually we update even deleted ones so if restored they are fresh.
            db.run("UPDATE items SET current_price = ?, last_checked = ?, screenshot_path = ? WHERE url = ?", 
                [freshData.price, now, freshData.screenshot, originItem.url],
                function() {
                    db.run("INSERT INTO prices (item_id, price, date) VALUES (?, ?, ?)", [id, freshData.price, now]);
                    broadcastUpdate();
                    res.json({ message: "Updated", price: freshData.price });
                }
            );
        } else { res.status(500).json({ error: "Scrape failed" }); }
    });
});

// EXPORT (Only active items)
app.get('/api/export', authenticateToken, (req, res) => {
    db.all("SELECT * FROM items WHERE user_id = ? AND deleted = 0", [req.user.id], (err, items) => {
        if (err) return res.status(500).send("Error fetching data");
        const fields = ['name', 'url', 'current_price', 'currency', 'date_added', 'shared_by', 'shared_on'];
        const json2csvParser = new Parser({ fields });
        const csv = json2csvParser.parse(items);
        res.header('Content-Type', 'text/csv');
        res.attachment('lootlook_export.csv');
        return res.send(csv);
    });
});

// AUTOMATION (Update all, even deleted?)
cron.schedule('0 */8 * * *', () => {
    // Only update items that are NOT deleted by ANYONE? Or update unique URLs regardless?
    // Better to update unique URLs found in the DB.
    db.all("SELECT DISTINCT url FROM items WHERE deleted = 0", [], async (err, rows) => {
        if (err) return;
        let didUpdate = false;
        for (const row of rows) {
            const freshData = await scrapeProduct(row.url);
            if (freshData) {
                 db.run("UPDATE items SET current_price = ?, last_checked = ?, screenshot_path = ? WHERE url = ?", 
                    [freshData.price, new Date().toISOString(), freshData.screenshot, row.url], 
                    function() { if(this.changes > 0) didUpdate = true; }
                 );
            }
        }
        if(didUpdate) broadcastUpdate();
    });
});

// JANITOR (Empty Trash after 30 days of deletion? Or just retention days?)
cron.schedule('0 0 * * *', () => {
    // Original retention logic for price history points
    db.all("SELECT id, retention_days FROM items", [], (err, rows) => {
        rows.forEach(item => {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - item.retention_days);
            db.run("DELETE FROM prices WHERE item_id = ? AND date < ?", [item.id, cutoffDate.toISOString()], (err) => {});
        });
    });
    
    // HARD DELETE items marked as 'deleted' for > 30 days (Optional, not implemented here to be safe)
});

app.use(express.static(path.join(__dirname, '../client/dist')));
app.get('*', (req, res) => { res.sendFile(path.join(__dirname, '../client/dist/index.html')); });
server.listen(PORT, () => { console.log(`Server running on port ${PORT}`); });