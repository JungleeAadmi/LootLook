const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const path = require('path'); 
const Tesseract = require('tesseract.js'); // OCR Engine

puppeteer.use(StealthPlugin());

const wait = (ms) => new Promise(r => setTimeout(r, ms));

// --- VISUAL SCRAPER (OCR) ---
async function visualScrape(imageBuffer) {
    try {
        const { data: { text } } = await Tesseract.recognize(imageBuffer, 'eng');
        // Look for price patterns like ₹ 1,299 or $10.50
        const priceRegex = /([₹$€£Rs])\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/gi;
        const matches = text.match(priceRegex);
        
        if (matches && matches.length > 0) {
            // Return the first valid price found
            return matches[0]; 
        }
        return null;
    } catch (e) {
        console.error("OCR Failed:", e);
        return null;
    }
}

async function scrapeProduct(url) {
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage',
                '--window-size=1920,1080',
                '--disable-blink-features=AutomationControlled',
                '--disable-features=IsolateOrigins,site-per-process',
                '--lang=en-US,en'
            ]
        });

        const page = await browser.newPage();
        
        // ... [Keep existing Stealth Headers & Setup] ...
        await page.emulateTimezone('Asia/Kolkata');
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1366, height: 768 });

        let attempts = 0;
        let finalData = { title: 'Unknown', image: '', price: 0, currency: '$' };

        while (attempts < 2) {
            attempts++;
            try {
                if (attempts > 1) {
                    const client = await page.target().createCDPSession();
                    await client.send('Network.clearBrowserCookies');
                }

                await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });
                
                // ... [Keep existing Waits & Auto-Scroll] ...
                await wait(3000);

                // 1. TRY STANDARD SCRAPING FIRST
                finalData = await page.evaluate(() => {
                    // ... [Keep existing selector logic] ...
                    // (Return { title, image, price, currency })
                    let price = 0; 
                    // ... logic to find price ...
                    return { price: price, ...otherData };
                });

                // 2. IF FAILED -> ACTIVATE VISUAL SCRAPER
                if (!finalData.price || finalData.price === 0) {
                    console.log("Standard scrape failed. Attempting Visual OCR...");
                    
                    // Take screenshot of the likely price area (top half of page)
                    // We clip it to save processing time
                    const screenshot = await page.screenshot({
                        clip: { x: 0, y: 0, width: 1366, height: 800 }, 
                        encoding: 'buffer' 
                    });
                    
                    const ocrPrice = await visualScrape(screenshot);
                    if (ocrPrice) {
                        console.log(`OCR found price: ${ocrPrice}`);
                        finalData.price = ocrPrice; // "₹1,299"
                    }
                }

                // Parse Price String to Number
                if (finalData.price) {
                    let p = parseFloat(finalData.price.toString().replace(/[^0-9.]/g, ''));
                    if (!isNaN(p) && p > 0) {
                        finalData.price = p;
                        break; 
                    }
                }

            } catch (e) { console.log("Attempt failed:", e.message); }
        }

        // ... [Keep existing Currency Forcing & Return] ...
        return finalData;

    } catch (error) {
        return null;
    } finally {
        if (browser) await browser.close();
    }
}

module.exports = { scrapeProduct };