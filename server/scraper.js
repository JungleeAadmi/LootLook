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
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage',
                '--window-size=1920,1080', 
                '--disable-blink-features=AutomationControlled', // Crucial for detection evasion
                '--disable-features=IsolateOrigins,site-per-process',
                '--lang=en-US,en;q=0.9'
            ],
            ignoreHTTPSErrors: true
        });

        const page = await browser.newPage();
        
        // Advanced Stealth
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
        });

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setExtraHTTPHeaders({ 
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Upgrade-Insecure-Requests': '1',
            'Cache-Control': 'max-age=0'
        });
        
        await page.setViewport({ width: 1080, height: 1920 });

        // Navigate with robust wait
        try { 
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }); 
            await wait(2000); // Initial settle
        } catch(e) { console.log("Navigation timeout/error, continuing...", e.message); }

        // --- DYNAMIC LOADING FIXES ---
        
        // 1. Full Page Scroll (Down AND Up)
        await page.evaluate(async () => {
            await new Promise((resolve) => {
                let totalHeight = 0;
                const distance = 200;
                const timer = setInterval(() => {
                    const scrollHeight = document.body.scrollHeight;
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    if(totalHeight >= 3500){ 
                        clearInterval(timer);
                        window.scrollTo(0, 0);
                        resolve();
                    }
                }, 50);
            });
        });

        // 2. Wait for Fonts & Images
        try {
            await page.waitForFunction('document.fonts.ready');
        } catch (e) {}
        await wait(3000); 

        // 3. Inject Styles (Fix Currency & Hide Popups)
        await page.evaluate(() => {
            const style = document.createElement('style');
            style.innerHTML = `
                * { font-family: Arial, Helvetica, sans-serif !important; }
                #cookie-banner, .cookie-consent, .popup, .modal, [id*="popup"], [class*="popup"], [aria-modal="true"] { display: none !important; }
            `; 
            document.head.appendChild(style);
        });
        await wait(500);

        // --- CAPTURE SCREENSHOT ---
        await page.screenshot({ 
            path: filepath, 
            type: 'jpeg', 
            quality: 75, 
            clip: { x: 0, y: 0, width: 1080, height: 1500 }
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
                // Added more selectors
                const selectors = [
                    '.product-price', '.price', '.a-price-whole', '._30jeq3', 
                    '.pdp-price', '.ProductDescriptionPage__price', 
                    'h4[color="greyBase"]', '#ProductPrice', '.PdpInfo__Price',
                    '[data-testid="price"]', '.Price__Value'
                ];
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