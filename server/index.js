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

// Serve Screenshots
app.use('/screenshots', express.static(path.join(__dirname, 'screenshots')));
const screenshotDir = path.join(__dirname, 'screenshots');
if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir);

// --- MIDDLEWARE: AUTHENTICATION ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token == null) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

// --- SOCKET.IO ---
io.on('connection', (socket) => { /* ... */ });
const broadcastUpdate = () => { io.emit('REFRESH_DATA'); };

// --- URL CLEANER ---
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

// --- AUTH ROUTES ---

app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    db.run(`INSERT INTO users (username, password, created_at) VALUES (?, ?, ?)`, 
        [username, hashedPassword, new Date().toISOString()], 
        function(err) {
            if (err) return res.status(400).json({ error: "Username taken" });
            res.json({ message: "Registered successfully" });
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
        res.json({ token, username: user.username });
    });
});

// --- PROTECTED API ROUTES ---

app.get('/api/items', authenticateToken, (req, res) => {
    // Only get items for THIS user
    db.all("SELECT * FROM items WHERE user_id = ? ORDER BY id DESC", [req.user.id], (err, rows) => {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ data: rows });
    });
});

app.post('/api/items', authenticateToken, async (req, res) => {
    const { url, retention } = req.body;
    const cleanedUrl = cleanUrl(url);
    const data = await scrapeProduct(cleanedUrl);
    
    if (!data) return res.status(500).json({ error: "Could not scrape link." });

    const now = new Date().toISOString();
    const sql = `INSERT INTO items (user_id, url, name, image_url, screenshot_path, current_price, previous_price, currency, retention_days, last_checked, date_added) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const params = [
        req.user.id, // Bind to user
        cleanedUrl, data.title, data.image, data.screenshot, 
        data.price, data.price, data.currency || '$', retention || 30, now, now
    ];

    db.run(sql, params, function(err) {
        if (err) return res.status(400).json({ error: err.message });
        db.run(`INSERT INTO prices (item_id, price, date) VALUES (?, ?, ?)`, [this.lastID, data.price, now]);
        broadcastUpdate();
        res.json({ message: "Item added", id: this.lastID, ...data });
    });
});

app.put('/api/items/:id', authenticateToken, (req, res) => {
    const { url, retention } = req.body;
    // Ensure user owns item
    db.run("UPDATE items SET url = ?, retention_days = ? WHERE id = ? AND user_id = ?", 
        [cleanUrl(url), retention, req.params.id, req.user.id], 
        function(err) {
            if (err) return res.status(400).json({ error: err.message });
            if (this.changes === 0) return res.status(403).json({ error: "Not authorized" });
            broadcastUpdate();
            res.json({ message: "Updated" });
        }
    );
});

app.delete('/api/items/:id', authenticateToken, (req, res) => {
    // Verify ownership before delete
    db.get("SELECT screenshot_path FROM items WHERE id = ? AND user_id = ?", [req.params.id, req.user.id], (err, row) => {
        if (!row) return res.status(403).json({ error: "Not authorized or not found" });
        
        if (row.screenshot_path) {
            const filePath = path.join(__dirname, 'screenshots', row.screenshot_path);
            if(fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
        db.run("DELETE FROM items WHERE id = ?", req.params.id, (err) => {
            broadcastUpdate();
            res.json({ message: "Deleted" });
        });
    });
});

app.get('/api/history/:id', authenticateToken, (req, res) => {
    // Verify ownership
    db.get("SELECT id FROM items WHERE id = ? AND user_id = ?", [req.params.id, req.user.id], (err, row) => {
        if(!row) return res.status(403).json({ error: "Access Denied" });
        
        db.all("SELECT * FROM prices WHERE item_id = ? ORDER BY date ASC", [req.params.id], (err, rows) => {
            res.json({ data: rows });
        });
    });
});

app.post('/api/refresh/:id', authenticateToken, (req, res) => {
    const id = req.params.id;
    db.get("SELECT * FROM items WHERE id = ? AND user_id = ?", [id, req.user.id], async (err, item) => {
        if (err || !item) return res.status(404).json({ error: "Item not found" });

        const freshData = await scrapeProduct(item.url);
        if (freshData) {
            let prevPrice = (freshData.price !== item.current_price) ? item.current_price : item.previous_price;
            db.run("UPDATE items SET current_price = ?, previous_price = ?, currency = ?, screenshot_path = ?, last_checked = ? WHERE id = ?", 
                [freshData.price, prevPrice, freshData.currency || '$', freshData.screenshot, new Date().toISOString(), id]);
            db.run("INSERT INTO prices (item_id, price, date) VALUES (?, ?, ?)", [id, freshData.price, new Date().toISOString()]);
            broadcastUpdate();
            res.json({ message: "Updated", price: freshData.price });
        } else {
            res.status(500).json({ error: "Scrape failed" });
        }
    });
});

// --- DATA EXPORT (CSV) ---
app.get('/api/export', authenticateToken, (req, res) => {
    db.all("SELECT * FROM items WHERE user_id = ?", [req.user.id], (err, items) => {
        if (err) return res.status(500).send("Error fetching data");
        
        const fields = ['name', 'url', 'current_price', 'currency', 'date_added'];
        const json2csvParser = new Parser({ fields });
        const csv = json2csvParser.parse(items);
        
        res.header('Content-Type', 'text/csv');
        res.attachment('lootlook_export.csv');
        return res.send(csv);
    });
});


// --- AUTOMATION (Runs for ALL users) ---
cron.schedule('0 */6 * * *', () => {
    db.all("SELECT * FROM items", [], async (err, rows) => {
        if (err) return;
        let didUpdate = false;
        for (const item of rows) {
            const freshData = await scrapeProduct(item.url);
            if (freshData && freshData.price !== item.current_price) {
                db.run("UPDATE items SET current_price = ?, previous_price = ?, currency = ?, screenshot_path = ?, last_checked = ? WHERE id = ?", 
                    [freshData.price, item.current_price, freshData.currency || '$', freshData.screenshot, new Date().toISOString(), item.id]);
                db.run("INSERT INTO prices (item_id, price, date) VALUES (?, ?, ?)", [item.id, freshData.price, new Date().toISOString()]);
                didUpdate = true;
            }
        }
        if(didUpdate) broadcastUpdate();
    });
});

// --- JANITOR ---
cron.schedule('0 0 * * *', () => {
    db.all("SELECT id, retention_days FROM items", [], (err, rows) => {
        rows.forEach(item => {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - item.retention_days);
            db.run("DELETE FROM prices WHERE item_id = ? AND date < ?", [item.id, cutoffDate.toISOString()], (err) => {});
        });
    });
});

app.use(express.static(path.join(__dirname, '../client/dist')));
app.get('*', (req, res) => { res.sendFile(path.join(__dirname, '../client/dist/index.html')); });

server.listen(PORT, () => { console.log(`Server running on port ${PORT}`); });