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

// --- HELPER: URL SANITIZER (NEW FEATURE) ---
function cleanUrl(rawUrl) {
    try {
        const urlObj = new URL(rawUrl);
        
        // Generic: Remove common tracking params
        const paramsToRemove = ['utm_source', 'utm_medium', 'utm_campaign', 'ref', 'ref_', 'tag', 'fbclid', 'gclid'];
        paramsToRemove.forEach(param => urlObj.searchParams.delete(param));

        // Platform Specific Cleaning
        const hostname = urlObj.hostname;

        // Amazon: Keep only /dp/ASIN
        if (hostname.includes('amazon')) {
            const match = urlObj.pathname.match(/\/dp\/([A-Z0-9]{10})/);
            if (match) return `https://${hostname}/dp/${match[1]}`;
        }

        // Flipkart: Keep only /p/itmID
        if (hostname.includes('flipkart')) {
            const match = urlObj.pathname.match(/\/p\/(itm[a-zA-Z0-9]+)/);
            if (match) {
                // Construct clean URL, flipkart sometimes needs product name slug but usually ID is enough
                // Let's just strip query params for Flipkart to be safe
                urlObj.search = ''; 
                return urlObj.toString();
            }
        }

        // Myntra: Remove all query params (usually ends in /buy)
        if (hostname.includes('myntra')) {
            urlObj.search = '';
        }

        return urlObj.toString();
    } catch (e) {
        return rawUrl; // If error, return original
    }
}

// --- API ROUTES ---

// 1. GET ALL ITEMS
app.get('/api/items', (req, res) => {
    db.all("SELECT * FROM items ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ data: rows });
    });
});

// 2. ADD NEW ITEM (Now with URL Cleaning)
app.post('/api/items', async (req, res) => {
    const { url, retention } = req.body;
    
    // FEATURE: Clean the URL before using it
    const cleanedUrl = cleanUrl(url);
    
    const data = await scrapeProduct(cleanedUrl);
    if (!data) return res.status(500).json({ error: "Could not scrape link" });

    const sql = `INSERT INTO items (url, name, image_url, current_price, previous_price, currency, retention_days, last_checked) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
    const params = [
        cleanedUrl, // Save the clean URL
        data.title, 
        data.image, 
        data.price, 
        data.price, // Initial previous_price = current_price
        data.currency || '$', 
        retention || 30, 
        new Date().toISOString()
    ];

    db.run(sql, params, function(err) {
        if (err) return res.status(400).json({ error: err.message });
        db.run(`INSERT INTO prices (item_id, price, date) VALUES (?, ?, ?)`, 
            [this.lastID, data.price, new Date().toISOString()]);
        res.json({ message: "Item added", id: this.lastID, ...data });
    });
});

// 3. EDIT ITEM (Now with URL Cleaning)
app.put('/api/items/:id', (req, res) => {
    const { url, retention } = req.body;
    const cleanedUrl = cleanUrl(url);
    
    db.run("UPDATE items SET url = ?, retention_days = ? WHERE id = ?", 
        [cleanedUrl, retention, req.params.id], 
        (err) => {
            if (err) return res.status(400).json({ error: err.message });
            res.json({ message: "Updated successfully" });
        }
    );
});

// 4. DELETE ITEM
app.delete('/api/items/:id', (req, res) => {
    db.run("DELETE FROM items WHERE id = ?", req.params.id, (err) => {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ message: "Deleted" });
    });
});

// 5. PRICE HISTORY
app.get('/api/history/:id', (req, res) => {
    db.all("SELECT * FROM prices WHERE item_id = ? ORDER BY date ASC", [req.params.id], (err, rows) => {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ data: rows });
    });
});

// 6. FORCE REFRESH
app.post('/api/refresh/:id', (req, res) => {
    const id = req.params.id;
    db.get("SELECT * FROM items WHERE id = ?", [id], async (err, item) => {
        if (err || !item) return res.status(404).json({ error: "Item not found" });

        const freshData = await scrapeProduct(item.url);
        if (freshData) {
            // Logic: Update Price, Currency, and Trend (previous_price)
            let prevPrice = item.current_price;
            // Only update previous_price if the price actually changed
            if (freshData.price === item.current_price) {
                prevPrice = item.previous_price; 
            }

            db.run("UPDATE items SET current_price = ?, previous_price = ?, currency = ?, last_checked = ? WHERE id = ?", 
                [freshData.price, prevPrice, freshData.currency || '$', new Date().toISOString(), id]);
                
            db.run("INSERT INTO prices (item_id, price, date) VALUES (?, ?, ?)", 
                [id, freshData.price, new Date().toISOString()]);
                
            res.json({ message: "Updated", price: freshData.price, currency: freshData.currency });
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
                db.run("UPDATE items SET current_price = ?, previous_price = ?, currency = ?, last_checked = ? WHERE id = ?", 
                    [freshData.price, item.current_price, freshData.currency || '$', new Date().toISOString(), item.id]);
                db.run("INSERT INTO prices (item_id, price, date) VALUES (?, ?, ?)", 
                    [item.id, freshData.price, new Date().toISOString()]);
            }
        }
    });
});

cron.schedule('0 0 * * *', () => {
    console.log('Running daily cleanup...');
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
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});