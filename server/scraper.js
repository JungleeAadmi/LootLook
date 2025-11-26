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
                '--disable-features=IsolateOrigins,site-per-process' // Fixes some frame issues
            ]
        });

        const page = await browser.newPage();
        
        // 1. MAX STEALTH HEADERS
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Referer': 'https://www.google.com/', 
            'Upgrade-Insecure-Requests': '1',
            'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
            'Sec-Ch-Ua-Mobile': '?0',
            'Sec-Ch-Ua-Platform': '"Windows"'
        });

        await page.setViewport({ width: 1366, height: 768 });
        
        // 2. NAVIGATION (Handle Redirects & Timeouts)
        try {
            // Networkidle2 waits for redirects (essential for sharein/dl.flipkart)
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });
        } catch (e) {
            console.log(`Navigation timeout on ${url}, trying to scrape anyway...`);
        }
        
        // 3. AGGRESSIVE AUTO-SCROLL (Fixes Robocraze/Savana/TataCliq Lazy Load)
        await page.evaluate(async () => {
            await new Promise((resolve) => {
                let totalHeight = 0;
                const distance = 150;
                const timer = setInterval(() => {
                    const scrollHeight = document.body.scrollHeight;
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    if(totalHeight >= scrollHeight || totalHeight > 4000){ // Scroll deep
                        clearInterval(timer);
                        resolve();
                    }
                }, 100);
            });
        });
        
        await wait(3000); // Wait for React/Vue to hydrate

        // 4. EXTRACTION LOGIC
        const data = await page.evaluate(() => {
            let title = document.title;
            let image = "";
            let price = 0;
            let currency = null;

            // --- JSON-LD (Primary Source) ---
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

            // --- SITE SPECIFIC FIXES ---
            
            // 1. Meesho (Access Denied Fix)
            // Meesho often puts price in a very specific H4
            const meeshoPrice = document.querySelector('h4.sc-eDvSVe, .ProductDescription__PriceText-sc-17crh2v-0 h4, h4[color="greyBase"]');
            if (meeshoPrice) { price = meeshoPrice.innerText; currency = 'INR'; }
            const meeshoImg = document.querySelector('div[data-testid="product-image"] img, .ProductImage__Image-sc-1199j7s-2');
            if (meeshoImg) image = meeshoImg.src;

            // 2. TataCliq
            const tataPrice = document.querySelector('.ProductDescriptionPage__price, .ProductDetailsMainCard__price h3');
            if (tataPrice) { price = tataPrice.innerText; currency = 'INR'; }
            const tataImg = document.querySelector('.ProductDetailsMainCard__galleryImage img, .ImageGallery__image img');
            if (tataImg) image = tataImg.src;

            // 3. Savana
            const savanaPrice = document.querySelector('.product-price-value');
            if (savanaPrice) { price = savanaPrice.innerText; currency = 'INR'; }
            const savanaImg = document.querySelector('.swiper-slide-active img');
            if (savanaImg) image = savanaImg.src;

            // 4. Quartz / Robocraze (Shopify)
            const shopifyPrice = document.querySelector('#ProductPrice, .price__current, .product-price, .price-item--regular');
            if (shopifyPrice) price = shopifyPrice.innerText.trim();
            const shopifyImg = document.querySelector('.product__media img, .product-gallery__image');
            if (shopifyImg) image = shopifyImg.src || shopifyImg.srcset?.split(' ')[0];

            // 5. Flipkart
            const flipkartPrice = document.querySelector('._30jeq3._16Jk6d, ._30jeq3');
            if (flipkartPrice) { price = flipkartPrice.innerText; currency = 'INR'; }
            const flipkartImg = document.querySelector('img._396cs4, img.q6DClP');
            if (flipkartImg) image = flipkartImg.src;

            // --- GENERIC FALLBACKS ---
            if (!price || price === 0) {
                const genericSelectors = ['.price', '.pdp-price', '.a-price-whole', '#priceblock_ourprice', 'bdi', '[data-testid="price"]'];
                for (let sel of genericSelectors) {
                    const el = document.querySelector(sel);
                    if (el && el.innerText.match(/[0-9]/)) {
                        price = el.innerText;
                        break;
                    }
                }
            }

            if (!image) {
                const metaImg = document.querySelector('meta[property="og:image"]');
                if (metaImg) image = metaImg.content;
            }

            return { title, image, price, currency };
        });

        // --- DATA CLEANING ---
        let finalPrice = 0;
        if (data.price) {
            // Clean non-numeric chars but keep dots
            finalPrice = parseFloat(data.price.toString().replace(/[^0-9.]/g, ''));
        }

        // FORCE INR for Known Indian Domains
        let finalCurrency = data.currency;
        const currentUrl = page.url();
        if (currentUrl.includes('.in') || currentUrl.includes('flipkart') || currentUrl.includes('meesho') || currentUrl.includes('tatacliq') || currentUrl.includes('robocraze') || currentUrl.includes('savana')) {
            finalCurrency = 'INR';
        } else {
            // Map codes to symbols
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