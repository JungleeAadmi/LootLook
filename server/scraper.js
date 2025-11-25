const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

async function scrapeProduct(url) {
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage',
                '--window-size=1920,1080'
            ]
        });

        const page = await browser.newPage();
        
        // 1. STEALTH UPGRADE: Set realistic headers
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Referer': 'https://www.google.com/', // Trick: "We came from Google"
            'Upgrade-Insecure-Requests': '1'
        });

        await page.setViewport({ width: 1366, height: 768 });
        
        // 2. Go to page (Wait longer for heavy sites)
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        // Wait random amount (human behavior)
        await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000));

        const data = await page.evaluate(() => {
            let title = document.title;
            let image = "";
            let price = 0;
            let currency = null;

            // --- STRATEGY 1: JSON-LD (Best for structured sites) ---
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

            // --- STRATEGY 2: SPECIFIC SELECTORS (Meesho & Others) ---
            if (!price || price === 0) {
                // Meesho Specifics
                const meeshoPrice = document.querySelector('.ProductDescription__PriceText-sc-17crh2v-0 h4'); 
                if (meeshoPrice) {
                    price = meeshoPrice.innerText;
                    currency = 'INR';
                }

                // Generic Fallbacks
                const priceSelectors = [
                    '.price', '#priceblock_ourprice', '.a-price-whole', // Amazon
                    '.pdp-price', // Myntra/Flipkart
                    '[data-testid="price"]', 
                    '.product-price', '.money',
                    '.woocommerce-Price-amount', 'bdi',
                    'h4' // Meesho often puts price in generic H4 tags
                ];
                
                for (let sel of priceSelectors) {
                    const el = document.querySelector(sel);
                    if (el && el.innerText.match(/[0-9]/)) {
                        // Ensure it's actually a price (contains numbers and isn't too long)
                        if (el.innerText.length < 20) {
                            const rawText = el.innerText;
                            price = rawText;
                            if (!currency) {
                                if (rawText.includes('₹') || rawText.includes('Rs') || rawText.includes('INR')) currency = 'INR';
                                else if (rawText.includes('$')) currency = 'USD';
                                else if (rawText.includes('€')) currency = 'EUR';
                                else if (rawText.includes('£')) currency = 'GBP';
                            }
                            break;
                        }
                    }
                }
            }

            // --- IMAGE FALLBACKS ---
            if (!image) {
                // Meesho Specific Image
                const meeshoImg = document.querySelector('div[data-testid="product-image"] img');
                if (meeshoImg) image = meeshoImg.src;

                // Generic
                if (!image) {
                    image = document.querySelector('meta[property="og:image"]')?.content ||
                            document.querySelector('#imgTagWrapperId img')?.src ||
                            "";
                }
            }

            return { title, image, price, currency };
        });

        // Cleanup Data
        let finalPrice = 0;
        if (data.price) {
            finalPrice = parseFloat(data.price.toString().replace(/[^0-9.]/g, ''));
        }

        const currencyMap = { 
            'INR': '₹', 'RS': '₹', 'RS.': '₹', '₹': '₹',
            'USD': '$', 'US': '$', '$': '$',
            'EUR': '€', '€': '€',
            'GBP': '£', '£': '£'
        };
        
        let cleanCurrency = data.currency ? data.currency.toString().toUpperCase().trim().replace('.', '') : 'USD';
        let finalCurrency = currencyMap[cleanCurrency] || '$';

        return {
            title: data.title ? data.title.substring(0, 100) : 'Unknown Product',
            image: data.image,
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