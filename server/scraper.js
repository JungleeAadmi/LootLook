const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const path = require('path'); 
const fs = require('fs');
const Tesseract = require('tesseract.js');

puppeteer.use(StealthPlugin());

const wait = (ms) => new Promise(r => setTimeout(r, ms));
const screenshotDir = path.join(__dirname, 'screenshots');
if (!fs.existsSync(screenshotDir)){ fs.mkdirSync(screenshotDir); }

async function visualScrape(imageBuffer) {
    try {
        const { data: { text } } = await Tesseract.recognize(imageBuffer, 'eng');
        const priceRegex = /([₹$€£]|Rs\.?)\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i;
        const matches = text.match(priceRegex);
        if (matches) return { currency: matches[1], price: matches[2] };
        return null;
    } catch (e) { return null; }
}

async function scrapeProduct(url) {
    let browser;
    const filename = `snap_${Date.now()}.jpg`;
    const filepath = path.join(screenshotDir, filename);
    
    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
                '--window-size=1920,1080', '--disable-blink-features=AutomationControlled',
                '--disable-features=IsolateOrigins,site-per-process', '--lang=en-US,en'
            ]
        });

        const page = await browser.newPage();
        await page.emulateTimezone('Asia/Kolkata');
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
        
        // Larger Viewport for Desktop-like rendering
        await page.setViewport({ width: 1366, height: 1200 });

        // Navigate with strict wait
        try { 
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 }); 
        } catch(e) { console.log("Navigation timeout, continuing..."); }

        // --- INTERACTIVE CLEANUP ---
        // 1. Auto-Scroll (Trigger lazy loads)
        await page.evaluate(async () => {
            await new Promise((resolve) => {
                let totalHeight = 0;
                const distance = 150;
                const timer = setInterval(() => {
                    const scrollHeight = document.body.scrollHeight;
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    if(totalHeight >= scrollHeight || totalHeight > 2500){ clearInterval(timer); resolve(); }
                }, 100);
            });
        });
        
        // 2. Wait for settling
        await wait(3000); 

        // 3. Force Standard Font & Hide Popups
        await page.evaluate(() => {
            // Fix Currency Symbols
            const style = document.createElement('style');
            style.innerHTML = `
                * { font-family: Arial, Helvetica, sans-serif !important; }
                #cookie-banner, .cookie-consent, .popup, .modal, [id*="popup"], [class*="popup"] { display: none !important; }
            `; 
            document.head.appendChild(style);
        });
        await wait(1000); // Wait for font switch

        // --- CAPTURE SCREENSHOT ---
        await page.screenshot({ 
            path: filepath, 
            type: 'jpeg', 
            quality: 70, 
            clip: { x: 0, y: 0, width: 1366, height: 1000 } // Capture top 1000px
        });

        let data = await page.evaluate(() => {
            let title = document.title;
            let image = "";
            let price = 0;
            let currency = null;

            const metaPrice = document.querySelector('meta[property="product:price:amount"]')?.content || document.querySelector('meta[property="og:price:amount"]')?.content;
            if(metaPrice) price = metaPrice;
            const metaImage = document.querySelector('meta[property="og:image"]')?.content;
            if(metaImage) image = metaImage;

            if(!price || price == 0) {
                const selectors = ['.product-price', '.price', '.a-price-whole', '._30jeq3', '.pdp-price', '.ProductDescriptionPage__price', 'h4[color="greyBase"]', '#ProductPrice', '.PdpInfo__Price'];
                for (let sel of selectors) {
                    const el = document.querySelector(sel);
                    if (el && el.innerText.match(/[0-9]/)) { price = el.innerText; break; }
                }
            }
            return { title, image, price, currency };
        });

        if (!data.price || data.price == 0) {
            const imageBuffer = fs.readFileSync(filepath);
            const ocrResult = await visualScrape(imageBuffer);
            if (ocrResult) { data.price = ocrResult.price; data.currency = ocrResult.currency; }
        }

        let finalPrice = 0;
        if (data.price) finalPrice = parseFloat(data.price.toString().replace(/[^0-9.]/g, ''));

        let finalCurrency = data.currency;
        const currentUrl = page.url().toLowerCase();
        if (['.in', 'flipkart', 'meesho', 'tatacliq', 'myntra', 'savana', 'quartz'].some(s => currentUrl.includes(s))) finalCurrency = 'INR';
        
        if (!finalCurrency || finalCurrency === 'INR' || finalCurrency === 'Rs' || finalCurrency === 'Rs.') finalCurrency = '₹';
        else if (finalCurrency === 'USD') finalCurrency = '$';

        return {
            title: data.title ? data.title.substring(0, 100) : 'Unknown Product',
            image: data.image || '',
            screenshot: filename,
            price: finalPrice || 0,
            currency: finalCurrency
        };

    } catch (error) {
        console.error(`Scrape failed for ${url}:`, error.message);
        return null;
    } finally {
        if (browser) await browser.close();
    }
}

module.exports = { scrapeProduct };