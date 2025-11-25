const express = require('express');
const cors = require('cors');
const path = require('path'); 
const db = require('./db');
const { scrapeProduct } = require('./scraper');
const cron = require('node-cron');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// --- API ROUTES ---

app.get('/api/items', (req, res) => {
    db.all("SELECT * FROM items ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ data: rows });
    });
});

app.post('/api/items', async (req, res) => {
    const { url, retention } = req.body;
    const data = await scrapeProduct(url);
    if (!data) return res.status(500).json({ error: "Could not scrape link" });

    // New items have previous_price = current_price (Neutral trend initially)
    const sql = `INSERT INTO items (url, name, image_url, current_price, previous_price, currency, retention_days, last_checked) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
    const params = [
        url, data.title, data.image, data.price, data.price, 
        data.currency || '$', retention || 30, new Date().toISOString()
    ];

    db.run(sql, params, function(err) {
        if (err) return res.status(400).json({ error: err.message });
        db.run(`INSERT INTO prices (item_id, price, date) VALUES (?, ?, ?)`, [this.lastID, data.price, new Date().toISOString()]);
        res.json({ message: "Item added", id: this.lastID, ...data });
    });
});

app.put('/api/items/:id', (req, res) => {
    const { url, retention } = req.body;
    db.run("UPDATE items SET url = ?, retention_days = ? WHERE id = ?", [url, retention, req.params.id], (err) => {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ message: "Updated successfully" });
    });
});

app.delete('/api/items/:id', (req, res) => {
    db.run("DELETE FROM items WHERE id = ?", req.params.id, (err) => {
        if (err) return res.status(400).json({ error: err.message });
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
            // LOGIC: If price changed, update previous_price
            let prevPrice = item.current_price;
            if (freshData.price !== item.current_price) {
                prevPrice = item.current_price; // Save old price as previous
            } else {
                prevPrice = item.previous_price; // Keep existing previous
            }

            db.run("UPDATE items SET current_price = ?, previous_price = ?, currency = ?, last_checked = ? WHERE id = ?", 
                [freshData.price, prevPrice, freshData.currency || '$', new Date().toISOString(), id]);
                
            db.run("INSERT INTO prices (item_id, price, date) VALUES (?, ?, ?)", 
                [id, freshData.price, new Date().toISOString()]);
                
            res.json({ message: "Updated", price: freshData.price });
        } else {
            res.status(500).json({ error: "Scrape failed" });
        }
    });
});

// --- AUTOMATION ---
cron.schedule('0 */6 * * *', () => {
    console.log('Running scheduled price check...');
    db.all("SELECT * FROM items", [], async (err, rows) => {
        if (err) return;
        for (const item of rows) {
            const freshData = await scrapeProduct(item.url);
            if (freshData && freshData.price !== item.current_price) {
                // Price Changed! Update Current AND Previous
                db.run("UPDATE items SET current_price = ?, previous_price = ?, currency = ?, last_checked = ? WHERE id = ?", 
                    [freshData.price, item.current_price, freshData.currency || '$', new Date().toISOString(), item.id]);
                    
                db.run("INSERT INTO prices (item_id, price, date) VALUES (?, ?, ?)", 
                    [item.id, freshData.price, new Date().toISOString()]);
            }
        }
    });
});

cron.schedule('0 0 * * *', () => {
    db.all("SELECT id, retention_days FROM items", [], (err, rows) => {
        if (err) return;
        rows.forEach(item => {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - item.retention_days);
            db.run("DELETE FROM prices WHERE item_id = ? AND date < ?", [item.id, cutoffDate.toISOString()], (err) => {});
        });
    });
});

app.use(express.static(path.join(__dirname, '../client/dist')));
app.get('*', (req, res) => { res.sendFile(path.join(__dirname, '../client/dist/index.html')); });
app.listen(PORT, () => { console.log(`Server running on port ${PORT}`); });