const express = require('express');
const cors = require('cors');
const path = require('path'); 
const http = require('http'); // Required for Socket.io
const { Server } = require('socket.io'); // Required for Socket.io
const db = require('./db');
const { scrapeProduct } = require('./scraper');
const cron = require('node-cron');

const app = express();
// Wrap Express in HTTP server to attach Socket.io
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

const PORT = 3001;

app.use(cors());
app.use(express.json());

// --- LIVE SYNC ENGINE ---
// 1. Listen for connections
io.on('connection', (socket) => {
    // console.log('Device connected:', socket.id); // Optional logging
});

// 2. Broadcast Helper
const broadcastUpdate = () => {
    io.emit('REFRESH_DATA'); // This triggers the useEffect in App.jsx
};

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

// --- API ROUTES ---

app.get('/api/items', (req, res) => {
    db.all("SELECT * FROM items ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ data: rows });
    });
});

app.post('/api/items', async (req, res) => {
    const { url, retention } = req.body;
    const cleanedUrl = cleanUrl(url);
    const data = await scrapeProduct(cleanedUrl);
    
    if (!data) return res.status(500).json({ error: "Could not scrape link. Check URL or try again." });

    const now = new Date().toISOString();
    const sql = `INSERT INTO items (url, name, image_url, current_price, previous_price, currency, retention_days, last_checked, date_added) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const params = [
        cleanedUrl, data.title, data.image, data.price, data.price, 
        data.currency || '$', retention || 30, now, now
    ];

    db.run(sql, params, function(err) {
        if (err) return res.status(400).json({ error: err.message });
        db.run(`INSERT INTO prices (item_id, price, date) VALUES (?, ?, ?)`, [this.lastID, data.price, now]);
        
        broadcastUpdate(); // Trigger Live Update
        res.json({ message: "Item added", id: this.lastID, ...data });
    });
});

app.put('/api/items/:id', (req, res) => {
    const { url, retention } = req.body;
    db.run("UPDATE items SET url = ?, retention_days = ? WHERE id = ?", [cleanUrl(url), retention, req.params.id], (err) => {
        if (err) return res.status(400).json({ error: err.message });
        
        broadcastUpdate(); // Trigger Live Update
        res.json({ message: "Updated" });
    });
});

app.delete('/api/items/:id', (req, res) => {
    db.run("DELETE FROM items WHERE id = ?", req.params.id, (err) => {
        if (err) return res.status(400).json({ error: err.message });
        
        broadcastUpdate(); // Trigger Live Update
        res.json({ message: "Deleted" });
    });
});

app.get('/api/history/:id', (req, res) => {
    db.all("SELECT * FROM prices WHERE item_id = ? ORDER BY date ASC", [req.params.id], (err, rows) => {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ data: rows });
    });
});

app.post('/api/refresh/:id', (req, res) => {
    const id = req.params.id;
    db.get("SELECT * FROM items WHERE id = ?", [id], async (err, item) => {
        if (err || !item) return res.status(404).json({ error: "Item not found" });

        const freshData = await scrapeProduct(item.url);
        if (freshData) {
            let prevPrice = (freshData.price !== item.current_price) ? item.current_price : item.previous_price;
            
            db.run("UPDATE items SET current_price = ?, previous_price = ?, currency = ?, last_checked = ? WHERE id = ?", 
                [freshData.price, prevPrice, freshData.currency || '$', new Date().toISOString(), id]);
                
            db.run("INSERT INTO prices (item_id, price, date) VALUES (?, ?, ?)", 
                [id, freshData.price, new Date().toISOString()]);
            
            broadcastUpdate(); // Trigger Live Update
            res.json({ message: "Updated", price: freshData.price });
        } else {
            res.status(500).json({ error: "Scrape failed" });
        }
    });
});

// --- AUTOMATION (Every 6 Hours) ---
cron.schedule('0 */6 * * *', () => {
    db.all("SELECT * FROM items", [], async (err, rows) => {
        if (err) return;
        let didUpdate = false;
        for (const item of rows) {
            const freshData = await scrapeProduct(item.url);
            if (freshData && freshData.price !== item.current_price) {
                db.run("UPDATE items SET current_price = ?, previous_price = ?, currency = ?, last_checked = ? WHERE id = ?", 
                    [freshData.price, item.current_price, freshData.currency || '$', new Date().toISOString(), item.id]);
                db.run("INSERT INTO prices (item_id, price, date) VALUES (?, ?, ?)", [item.id, freshData.price, new Date().toISOString()]);
                didUpdate = true;
            }
        }
        if(didUpdate) broadcastUpdate(); // Trigger Live Update if cron changed anything
    });
});

// --- JANITOR (Daily) ---
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

// CHANGE: server.listen instead of app.listen to enable Sockets
server.listen(PORT, () => { console.log(`Server running on port ${PORT}`); });