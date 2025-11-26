const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const path = require('path'); 

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
                '--disable-blink-features=AutomationControlled', // Essential for TataCliq/Meesho
                '--disable-features=IsolateOrigins,site-per-process',
                '--lang=en-US,en'
            ]
        });

        const page = await browser.newPage();
        
        // 1. STEALTH CONFIGURATION
        await page.emulateTimezone('Asia/Kolkata');
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
            window.navigator.chrome = { runtime: {} };
        });

        // 2. RESOURCE OPTIMIZATION
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const type = req.resourceType();
            const blockedTypes = ['font', 'stylesheet']; 
            // Don't block images for Savana as we need to find the right one
            if (blockedTypes.includes(type)) {
                req.abort();
            } else {
                req.continue();
            }
        });

        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://www.google.com/',
            'Upgrade-Insecure-Requests': '1'
        });

        await page.setViewport({ width: 1366, height: 768 });

        let attempts = 0;
        let finalData = { title: 'Unknown', image: '', price: 0, currency: '$' };

        while (attempts < 2) {
            attempts++;
            try {
                console.log(`Attempt ${attempts} for ${url}...`);
                
                if (attempts > 1) {
                    const client = await page.target().createCDPSession();
                    await client.send('Network.clearBrowserCookies');
                }

                // NAVIGATION with Extended Wait for Redirects
                await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });

                // SPECIFIC WAITS
                if (url.includes('tatacliq')) {
                    try { await page.waitForSelector('.ProductDescriptionPage__price, .ProductDetailsMainCard__price', { timeout: 15000 }); } catch(e) {}
                }
                if (url.includes('apollopharmacy')) {
                    try { await page.waitForSelector('.PdpInfo__Price, .ProductPrice', { timeout: 10000 }); } catch(e) {}
                }

                // AUTO-SCROLL
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

                // DATA EXTRACTION
                finalData = await page.evaluate(() => {
                    let title = document.title;
                    let image = "";
                    let price = 0;
                    let currency = null;

                    // META TAGS (Best for Savana/Tata/Apollo)
                    const metaPrice = document.querySelector('meta[property="product:price:amount"]')?.content ||
                                      document.querySelector('meta[property="og:price:amount"]')?.content;
                    if (metaPrice) price = metaPrice;

                    const metaCurrency = document.querySelector('meta[property="product:price:currency"]')?.content ||
                                         document.querySelector('meta[property="og:price:currency"]')?.content;
                    if (metaCurrency) currency = metaCurrency;

                    const metaImage = document.querySelector('meta[property="og:image"]')?.content;
                    if (metaImage) image = metaImage;

                    // JSON-LD
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

                    // VISUAL SELECTORS
                    if (!price || price === 0) {
                        const selectors = [
                            '.ProductDescriptionPage__price', '.ProductDetailsMainCard__price h3', // Tata
                            'div._30jeq3._16Jk6d', 'div._30jeq3', // Flipkart
                            '.product-price-value', '#ProductPrice', '.price-item--regular', '.price__current', // Savana/Shopify
                            'h4[color="greyBase"]', '.ProductDescription__PriceText-sc-17crh2v-0 h4', // Meesho
                            '.PdpInfo__Price', '.ProductPrice', '.PriceGroup__Price', // Apollo
                            '.a-price-whole', '.price', '.money', 'bdi'
                        ];
                        
                        for (let sel of selectors) {
                            const el = document.querySelector(sel);
                            if (el && el.innerText.match(/[0-9]/)) {
                                const txt = el.innerText;
                                if(txt.length < 30) {
                                    price = txt;
                                    if (!currency) {
                                        if (txt.includes('₹')) currency = 'INR';
                                        else if (txt.includes('$')) currency = 'USD';
                                    }
                                    break;
                                }
                            }
                        }
                    }

                    if (!image) {
                        const imgSelectors = ['.ProductDetailsMainCard__galleryImage img', 'img._396cs4', '.product__media img', '.swiper-slide-active img', '#landingImage', '.ProductImage__Image'];
                        for (let sel of imgSelectors) {
                            const el = document.querySelector(sel);
                            if (el) { image = el.src || el.content; if(image) break; }
                        }
                    }

                    return { title, image, price, currency };
                });

                if (finalData.price) {
                    let p = parseFloat(finalData.price.toString().replace(/[^0-9.]/g, ''));
                    if (!isNaN(p) && p > 0) {
                        finalData.price = p;
                        break; 
                    }
                }
            } catch (e) { console.log("Attempt failed:", e.message); }
        }

        // DEBUG SNAPSHOT
        if (!finalData.price || finalData.price === 0) {
            try {
                const debugPath = path.resolve(__dirname, '../client/dist/debug.png');
                await page.screenshot({ path: debugPath, fullPage: false });
            } catch (e) {}
        }

        // FORCE INR
        let finalCurrency = finalData.currency;
        const currentUrl = page.url().toLowerCase();
        const indianSites = ['.in', 'flipkart', 'meesho', 'tatacliq', 'myntra', 'ajio', 'quartzcomponents', 'robocraze', 'savana', 'silverline', 'apollopharmacy'];

        if (indianSites.some(site => currentUrl.includes(site))) {
            finalCurrency = 'INR';
        } else {
            const currencyMap = { 'INR': '₹', 'RS': '₹', '₹': '₹', 'USD': '$', '$': '$', 'EUR': '€' };
            let clean = finalData.currency ? finalData.currency.toString().toUpperCase().replace('.', '').trim() : 'USD';
            finalCurrency = currencyMap[clean] || '$';
        }
        if (finalCurrency === 'INR') finalCurrency = '₹';

        return {
            title: finalData.title ? finalData.title.substring(0, 100) : 'Unknown Product',
            image: finalData.image || '',
            price: finalData.price || 0,
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