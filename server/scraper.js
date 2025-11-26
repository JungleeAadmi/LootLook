const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

// Helper to wait
const wait = (ms) => new Promise(r => setTimeout(r, ms));

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
                '--disable-blink-features=AutomationControlled', // Crucial for Meesho
                '--disable-features=IsolateOrigins,site-per-process'
            ]
        });

        const page = await browser.newPage();
        
        // 1. MAX STEALTH HEADERS (Randomized User Agent)
        const userAgents = [
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        ];
        const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];

        await page.setUserAgent(randomUA);
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Referer': 'https://www.google.com/', 
            'Upgrade-Insecure-Requests': '1'
        });

        await page.setViewport({ width: 1366, height: 768 });
        
        // 2. NAVIGATION (Handle Savana/Flipkart Redirects)
        try {
            // Savana share links take time to redirect. We wait until network is quiet.
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        } catch (e) {
            console.log(`Navigation timeout on ${url}, trying to scrape anyway...`);
        }
        
        // 3. AGGRESSIVE AUTO-SCROLL
        await page.evaluate(async () => {
            await new Promise((resolve) => {
                let totalHeight = 0;
                const distance = 100;
                const timer = setInterval(() => {
                    const scrollHeight = document.body.scrollHeight;
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    if(totalHeight >= scrollHeight || totalHeight > 4000){
                        clearInterval(timer);
                        resolve();
                    }
                }, 50); // Faster scroll
            });
        });
        
        await wait(3000); // Wait for dynamic content

        // 4. EXTRACTION LOGIC
        const data = await page.evaluate(() => {
            let title = document.title;
            let image = "";
            let price = 0;
            let currency = null;

            // --- STRATEGY 1: JSON-LD ---
            const scripts = document.querySelectorAll('script[type="application/ld+json"]');
            for (let script of scripts) {
                try {
                    const json = JSON.parse(script.innerText);
                    const product = Array.isArray(json) ? json.find(i => i['@type'] === 'Product') : json;
                    if (product) {
                        if (product.name) title = product.name;
                        if (product.image) image = Array.isArray(product.image) ? product.image[0] : product.image;
                        const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers;
                        if (offer) {
                            if (offer.price) price = offer.price;
                            if (offer.priceCurrency) currency = offer.priceCurrency;
                        }
                    }
                } catch (e) {}
            }

            // --- STRATEGY 2: SITE SPECIFIC FIXES ---
            
            // MEESHO FIX (H4 tags usually contain price)
            if (!price || price === 0) {
                const meeshoPrice = document.querySelector('.ProductDescription__PriceText-sc-17crh2v-0 h4, h4[color="greyBase"]');
                if (meeshoPrice) { price = meeshoPrice.innerText; currency = 'INR'; }
                
                const meeshoImg = document.querySelector('div[data-testid="product-image"] img');
                if (meeshoImg) image = meeshoImg.src;
            }

            // SAVANA FIX (Meta tags are best here)
            if (!price || price === 0) {
                // Try Savana specific classes first
                const savanaPrice = document.querySelector('.product-price-value');
                if (savanaPrice) { price = savanaPrice.innerText; currency = 'INR'; }
                
                // Fallback to Meta tags (Savana uses these reliably)
                if (!price) {
                    const metaPrice = document.querySelector('meta[property="product:price:amount"]')?.content;
                    if (metaPrice) { price = metaPrice; currency = 'INR'; }
                }
            }

            // TATACLIQ FIX
            if (!price || price === 0) {
                const tataPrice = document.querySelector('.ProductDescriptionPage__price, .ProductDetailsMainCard__price');
                if (tataPrice) { price = tataPrice.innerText; currency = 'INR'; }
            }

            // FLIPKART FIX
            if (!price || price === 0) {
                const flipPrice = document.querySelector('._30jeq3._16Jk6d, ._30jeq3');
                if (flipPrice) { price = flipPrice.innerText; currency = 'INR'; }
            }

            // GENERIC FALLBACKS
            if (!price || price === 0) {
                const selectors = ['.price', '.pdp-price', '.a-price-whole', '#priceblock_ourprice', 'bdi', '[data-testid="price"]'];
                for (let sel of selectors) {
                    const el = document.querySelector(sel);
                    if (el && el.innerText.match(/[0-9]/)) {
                        price = el.innerText;
                        break;
                    }
                }
            }

            if (!image) {
                const imgSelectors = ['meta[property="og:image"]', '.swiper-slide-active img', '#landingImage', 'img._396cs4'];
                for (let sel of imgSelectors) {
                    const el = document.querySelector(sel);
                    if (el) { image = el.src || el.content; if(image) break; }
                }
            }

            return { title, image, price, currency };
        });

        // --- DATA CLEANING ---
        let finalPrice = 0;
        if (data.price) {
            finalPrice = parseFloat(data.price.toString().replace(/[^0-9.]/g, ''));
        }

        // FORCE INR for Indian Sites
        let finalCurrency = data.currency;
        const currentUrl = page.url().toLowerCase();
        if (currentUrl.includes('.in') || currentUrl.includes('flipkart') || currentUrl.includes('meesho') || currentUrl.includes('tatacliq') || currentUrl.includes('robocraze') || currentUrl.includes('savana') || currentUrl.includes('quartz')) {
            finalCurrency = 'INR';
        } else {
            const currencyMap = { 'INR': '₹', 'RS': '₹', '₹': '₹', 'USD': '$', '$': '$', 'EUR': '€' };
            let clean = data.currency ? data.currency.toString().toUpperCase().replace('.', '').trim() : 'USD';
            finalCurrency = currencyMap[clean] || '$';
        }
        if (finalCurrency === 'INR') finalCurrency = '₹';

        return {
            title: data.title ? data.title.substring(0, 100) : 'Unknown Product',
            image: data.image || '',
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