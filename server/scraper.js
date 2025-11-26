const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

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
                '--disable-blink-features=AutomationControlled'
            ]
        });

        const page = await browser.newPage();
        
        // 1. STEALTH HEADERS
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://www.google.com/',
            'Upgrade-Insecure-Requests': '1'
        });

        await page.setViewport({ width: 1366, height: 768 });
        
        // 2. NAVIGATION
        try {
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });
        } catch (e) {
            console.log(`Navigation timeout on ${url}, scraping what we have...`);
        }
        
        // 3. AUTO-SCROLL
        await page.evaluate(async () => {
            await new Promise((resolve) => {
                let totalHeight = 0;
                const distance = 150;
                const timer = setInterval(() => {
                    const scrollHeight = document.body.scrollHeight;
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    if(totalHeight >= scrollHeight || totalHeight > 3000){
                        clearInterval(timer);
                        resolve();
                    }
                }, 100);
            });
        });
        
        await wait(2000);

        // 4. EXTRACTION
        const data = await page.evaluate(() => {
            let title = document.title;
            let image = "";
            let price = 0;
            let currency = null;

            // STRATEGY 1: META TAGS
            const metaPrice = document.querySelector('meta[property="product:price:amount"]')?.content ||
                              document.querySelector('meta[property="og:price:amount"]')?.content;
            if (metaPrice) price = metaPrice;

            const metaCurrency = document.querySelector('meta[property="product:price:currency"]')?.content ||
                                 document.querySelector('meta[property="og:price:currency"]')?.content;
            if (metaCurrency) currency = metaCurrency;

            const metaImage = document.querySelector('meta[property="og:image"]')?.content;
            if (metaImage) image = metaImage;

            // STRATEGY 2: JSON-LD
            if (!price || price === 0) {
                const scripts = document.querySelectorAll('script[type="application/ld+json"]');
                for (let script of scripts) {
                    try {
                        const json = JSON.parse(script.innerText);
                        const product = Array.isArray(json) ? json.find(i => i['@type'] === 'Product') : json;
                        if (product) {
                            if (product.name) title = product.name;
                            if (!image && product.image) image = Array.isArray(product.image) ? product.image[0] : product.image;
                            
                            const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers;
                            if (offer) {
                                if (offer.price) price = offer.price;
                                if (offer.priceCurrency) currency = offer.priceCurrency;
                            }
                        }
                    } catch (e) {}
                }
            }

            // STRATEGY 3: VISUAL SELECTORS
            if (!price || price === 0) {
                const selectors = [
                    '#ProductPrice', '.price-item--regular', '.price__current', '.product-price',
                    '.product-price-value', '.pdp-price',
                    '.ProductDescriptionPage__price', '.ProductDetailsMainCard__price h3',
                    'h4[color="greyBase"]', '.ProductDescription__PriceText-sc-17crh2v-0 h4',
                    '._30jeq3', '.a-price-whole', '.price', '.money', 'bdi'
                ];
                
                for (let sel of selectors) {
                    const el = document.querySelector(sel);
                    if (el && el.innerText.match(/[0-9]/)) {
                        const txt = el.innerText;
                        if(txt.length < 30) {
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

            // Image Fallbacks
            if (!image) {
                const imgSelectors = [
                    '.product__media img', '.swiper-slide-active img', 
                    '.ProductDetailsMainCard__galleryImage img', 'img._396cs4', '#landingImage'
                ];
                for (let sel of imgSelectors) {
                    const el = document.querySelector(sel);
                    if (el) { image = el.src || el.content; if(image) break; }
                }
            }

            return { title, image, price, currency };
        });

        // POST PROCESSING
        let finalPrice = 0;
        if (data.price) {
            finalPrice = parseFloat(data.price.toString().replace(/[^0-9.]/g, ''));
        }

        let finalCurrency = data.currency;
        const currentUrl = page.url().toLowerCase();
        
        const indianSites = ['.in', 'flipkart', 'meesho', 'tatacliq', 'myntra', 'ajio', 'quartzcomponents', 'robocraze', 'savana', 'silverline'];

        if (indianSites.some(site => currentUrl.includes(site))) {
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