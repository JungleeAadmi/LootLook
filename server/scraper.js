const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

// Helper
const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function scrapeProduct(url) {
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1920,1080', '--disable-blink-features=AutomationControlled']
        });

        const page = await browser.newPage();
        
        // STEALTH HEADERS
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://www.google.com/', 
            'Upgrade-Insecure-Requests': '1'
        });

        await page.setViewport({ width: 1366, height: 768 });
        
        // NAVIGATE WITH REDIRECT SUPPORT
        // Networkidle2 is crucial for "Share" links (amzn.in, dl.flipkart) to finish redirecting
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        
        // AUTO-SCROLL (Fixes Robocraze/Lazy Images)
        await page.evaluate(async () => {
            await new Promise((resolve) => {
                let totalHeight = 0;
                const distance = 150;
                const timer = setInterval(() => {
                    const scrollHeight = document.body.scrollHeight;
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    if(totalHeight >= scrollHeight || totalHeight > 2500){
                        clearInterval(timer);
                        resolve();
                    }
                }, 100);
            });
        });
        
        await wait(2000); 

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

            // --- STRATEGY 2: SPECIFIC SITE SELECTORS ---
            if (!price || price === 0) {
                const selectors = [
                    // Tata Cliq
                    '.ProductDescriptionPage__price', '.ProductDetailsMainCard__price',
                    // Savana
                    '.product-price-value',
                    // Quartz / Silverline / Robocraze (Shopify/WooCommerce)
                    '.price__current', '.product-price', '#ProductPrice', '.price', 
                    // Meesho
                    '.ProductDescription__PriceText-sc-17crh2v-0 h4', 'h4',
                    // Generic
                    '.pdp-price', '.a-price-whole', '#priceblock_ourprice', 'bdi', '[data-testid="price"]'
                ];
                
                for (let sel of selectors) {
                    const el = document.querySelector(sel);
                    if (el && el.innerText.match(/[0-9]/)) {
                        const txt = el.innerText;
                        if(txt.length < 40) { // Avoid grabbing description text
                            price = txt;
                            if (!currency) {
                                if (txt.includes('₹') || txt.includes('Rs')) currency = 'INR';
                                else if (txt.includes('$')) currency = 'USD';
                            }
                            break;
                        }
                    }
                }
            }

            // --- IMAGE FALLBACKS ---
            if (!image) {
                const imgSelectors = [
                    'meta[property="og:image"]',
                    '.ProductDetailsMainCard__galleryImage', // TataCliq
                    'div[data-testid="product-image"] img', // Meesho
                    '.swiper-slide-active img', // Savana
                    '.product-gallery__image', // Shopify
                    '#landingImage', // Amazon
                    '.image-grid-image' // Myntra
                ];
                for (let sel of imgSelectors) {
                    const el = document.querySelector(sel);
                    if (el) { image = el.src || el.content; if(image) break; }
                }
            }

            return { title, image, price, currency };
        });

        // DATA CLEANING
        let finalPrice = 0;
        if (data.price) {
            finalPrice = parseFloat(data.price.toString().replace(/[^0-9.]/g, ''));
        }

        // FORCE INR for Indian Sites
        let finalCurrency = data.currency;
        const currentUrl = page.url(); // Get final URL after redirect
        if (currentUrl.includes('.in') || currentUrl.includes('flipkart') || currentUrl.includes('meesho') || currentUrl.includes('tatacliq') || currentUrl.includes('robocraze')) {
            finalCurrency = 'INR';
        } else {
            const currencyMap = { 'INR': '₹', 'RS': '₹', '₹': '₹', 'USD': '$', '$': '$' };
            let clean = data.currency ? data.currency.toString().toUpperCase().replace('.', '') : 'USD';
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