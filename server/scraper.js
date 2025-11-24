const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

async function scrapeProduct(url) {
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1366, height: 768 });
        
        // 1. Go to page and wait a bit
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        
        // Wait an extra 2 seconds for dynamic prices to load
        await new Promise(r => setTimeout(r, 2000));

        const data = await page.evaluate(() => {
            let title = document.title;
            let image = "";
            let price = 0;
            let currency = null; // Changed default from '$' to null to detect missing currency

            // --- STRATEGY 1: JSON-LD (The "Nuclear Option") ---
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

            // --- STRATEGY 2: META TAGS ---
            if (!price || price === 0) {
                const metaPrice = document.querySelector('meta[property="product:price:amount"]')?.content ||
                                  document.querySelector('meta[name="twitter:data1"]')?.content;
                if (metaPrice) price = metaPrice;

                const metaCurrency = document.querySelector('meta[property="product:price:currency"]')?.content;
                if (metaCurrency) currency = metaCurrency;
            }

            // --- STRATEGY 3: VISUAL SELECTORS (Smart Text Analysis) ---
            if (!price || price === 0) {
                const priceSelectors = [
                    '.price', '#priceblock_ourprice', '.a-price-whole', // Amazon
                    '.pdp-price', // Myntra
                    '[data-testid="price"]', // Generic
                    '.product-price', '.money',
                    '.woocommerce-Price-amount', 'bdi' // WooCommerce/Robu
                ];
                
                for (let sel of priceSelectors) {
                    const el = document.querySelector(sel);
                    if (el && el.innerText.match(/[0-9]/)) {
                        const rawText = el.innerText;
                        price = rawText;
                        
                        // Smart Currency Detection from text
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

            // --- IMAGE FALLBACKS ---
            if (!image) {
                image = document.querySelector('meta[property="og:image"]')?.content ||
                        document.querySelector('#imgTagWrapperId img')?.src ||
                        "";
            }

            return { title, image, price, currency };
        });

        // Cleanup Data
        let finalPrice = 0;
        if (data.price) {
            // Remove everything that isn't a dot or a number
            finalPrice = parseFloat(data.price.toString().replace(/[^0-9.]/g, ''));
        }

        // Expanded Currency Map
        const currencyMap = { 
            'INR': '₹', 'RS': '₹', 'RS.': '₹', '₹': '₹',
            'USD': '$', 'US': '$', '$': '$',
            'EUR': '€', '€': '€',
            'GBP': '£', '£': '£'
        };
        
        // Normalize currency string (uppercase, trim, remove dots)
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