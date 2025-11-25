const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

// Helper to wait
const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function scrapeProduct(url) {
    let browser;
    try {
        // LAUNCH CONFIG
        browser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage',
                '--window-size=1920,1080',
                '--disable-blink-features=AutomationControlled' // Hide webdriver
            ]
        });

        const page = await browser.newPage();
        
        // 1. STEALTH HEADERS (Randomized)
        const agents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/119.0'
        ];
        const ua = agents[Math.floor(Math.random() * agents.length)];
        
        await page.setUserAgent(ua);
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Referer': 'https://www.google.com/', 
            'Upgrade-Insecure-Requests': '1',
            'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
            'Sec-Ch-Ua-Mobile': '?0',
            'Sec-Ch-Ua-Platform': '"Windows"'
        });

        await page.setViewport({ width: 1366, height: 768 });
        
        // 2. HANDLE REDIRECTS (For Myntra/Deep links)
        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        } catch (e) {
            console.log("Navigation timeout, trying to scrape anyway...");
        }
        
        // 3. AUTO-SCROLL (Fixes missing images/lazy loading)
        await page.evaluate(async () => {
            await new Promise((resolve) => {
                let totalHeight = 0;
                const distance = 100;
                const timer = setInterval(() => {
                    const scrollHeight = document.body.scrollHeight;
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    if(totalHeight >= scrollHeight || totalHeight > 2000){ // Scroll max 2000px
                        clearInterval(timer);
                        resolve();
                    }
                }, 100);
            });
        });
        
        await wait(3000); // Wait for lazy images to render

        // 4. EXTRACT DATA
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

            // --- STRATEGY 2: SPECIFIC SELECTORS ---
            if (!price || price === 0) {
                const selectors = [
                    // Meesho
                    '.ProductDescription__PriceText-sc-17crh2v-0 h4',
                    'h4[color="greyBase"]',
                    // Flipkart
                    '._30jeq3._16Jk6d', '._30jeq3', '.CEmiEU ._30jeq3',
                    // Myntra
                    '.pdp-price', '.pdp-selling-price', 
                    // Amazon
                    '.a-price-whole', '#priceblock_ourprice',
                    // Generic
                    '[data-testid="price"]', '.product-price', '.price', '.money', 'bdi'
                ];
                
                for (let sel of selectors) {
                    const el = document.querySelector(sel);
                    if (el && el.innerText.match(/[0-9]/)) {
                        const txt = el.innerText;
                        // Filter out "MRP" or "Discount" labels if accidentally grabbed
                        if(txt.length < 30) {
                            price = txt;
                            // Detect Currency
                            if (!currency) {
                                if (txt.includes('₹') || txt.includes('Rs')) currency = 'INR';
                                else if (txt.includes('$')) currency = 'USD';
                                else if (txt.includes('€')) currency = 'EUR';
                                else if (txt.includes('£')) currency = 'GBP';
                            }
                            break;
                        }
                    }
                }
            }

            // --- IMAGE FALLBACKS ---
            if (!image) {
                const imgSelectors = [
                    // Meesho
                    'div[data-testid="product-image"] img',
                    '.ProductImage__Image-sc-1199j7s-2',
                    // Myntra
                    '.image-grid-image',
                    // Flipkart
                    'img._396cs4', 'img.q6DClP',
                    // Amazon
                    '#landingImage', '#imgTagWrapperId img',
                    // Generic
                    'meta[property="og:image"]',
                    '.product-image img', '.wp-post-image'
                ];

                for (let sel of imgSelectors) {
                    const el = document.querySelector(sel);
                    if (el) {
                        image = el.src || el.content;
                        if(image) break;
                    }
                }
            }

            return { title, image, price, currency };
        });

        // --- DATA CLEANING ---
        let finalPrice = 0;
        if (data.price) {
            finalPrice = parseFloat(data.price.toString().replace(/[^0-9.]/g, ''));
        }

        const currencyMap = { 'INR': '₹', 'RS': '₹', '₹': '₹', 'USD': '$', '$': '$', 'EUR': '€', 'GBP': '£' };
        let cleanCurrency = data.currency ? data.currency.toString().toUpperCase().trim().replace('.', '') : 'USD';
        let finalCurrency = currencyMap[cleanCurrency] || '$';

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