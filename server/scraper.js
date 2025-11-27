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
                '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
                '--window-size=1920,1080',
                '--disable-blink-features=AutomationControlled',
                '--disable-features=IsolateOrigins,site-per-process'
            ]
        });

        const page = await browser.newPage();
        
        // Stealth Configuration
        await page.emulateTimezone('Asia/Kolkata');
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
            window.navigator.chrome = { runtime: {} };
        });

        // Resource Blocking (Speeds up & bypasses some blocks)
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const type = req.resourceType();
            const blockedTypes = ['font', 'stylesheet'];
            if (blockedTypes.includes(type)) req.abort();
            else req.continue();
        });

        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
        await page.setViewport({ width: 1366, height: 768 });

        let attempts = 0;
        let finalData = { title: 'Unknown', image: '', price: 0, currency: '$' };

        while (attempts < 2) {
            attempts++;
            try {
                if (attempts > 1) {
                    const client = await page.target().createCDPSession();
                    await client.send('Network.clearBrowserCookies');
                }

                // Long timeout for redirects
                await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });

                // TataCliq specific wait
                if (url.includes('tatacliq')) {
                    try { await page.waitForSelector('.ProductDescriptionPage__price', { timeout: 15000 }); } catch(e) {}
                }

                // Aggressive Scroll
                await page.evaluate(async () => {
                    await new Promise((resolve) => {
                        let totalHeight = 0;
                        const distance = 150;
                        const timer = setInterval(() => {
                            const scrollHeight = document.body.scrollHeight;
                            window.scrollBy(0, distance);
                            totalHeight += distance;
                            if(totalHeight >= scrollHeight || totalHeight > 4000){
                                clearInterval(timer);
                                resolve();
                            }
                        }, 50);
                    });
                });
                await wait(2000);

                // Extraction
                finalData = await page.evaluate(() => {
                    let title = document.title;
                    let image = "";
                    let price = 0;
                    let currency = null;

                    // Meta Tags
                    const metaPrice = document.querySelector('meta[property="product:price:amount"]')?.content || document.querySelector('meta[property="og:price:amount"]')?.content;
                    if (metaPrice) price = metaPrice;
                    
                    const metaImage = document.querySelector('meta[property="og:image"]')?.content;
                    if (metaImage) image = metaImage;

                    // JSON-LD
                    if (!price) {
                        const scripts = document.querySelectorAll('script[type="application/ld+json"]');
                        for (let script of scripts) {
                            try {
                                const json = JSON.parse(script.innerText);
                                const product = Array.isArray(json) ? json.find(i => i['@type'] === 'Product') : json;
                                if (product) {
                                    if (product.name) title = product.name;
                                    if (!image && product.image) image = Array.isArray(product.image) ? product.image[0] : product.image;
                                    const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers;
                                    if (offer && offer.price) { price = offer.price; }
                                }
                            } catch (e) {}
                        }
                    }

                    // Visual Selectors
                    if (!price || price == 0) {
                        const selectors = [
                            '.ProductDescriptionPage__price', 'h4[color="greyBase"]', // Tata, Meesho
                            '.product-price-value', '#ProductPrice', '.price-item--regular', // Savana, Shopify
                            '.PdpInfo__Price', '.ProductPrice', // Apollo
                            '._30jeq3', '.a-price-whole', '.price', '.money', 'bdi'
                        ];
                        for (let sel of selectors) {
                            const el = document.querySelector(sel);
                            if (el && el.innerText.match(/[0-9]/)) {
                                price = el.innerText;
                                break;
                            }
                        }
                    }

                    // Image Fallbacks
                    if (!image) {
                        const imgSelectors = ['.ProductDetailsMainCard__galleryImage img', 'img._396cs4', '.product__media img', '.swiper-slide-active img', '#landingImage'];
                        for (let sel of imgSelectors) {
                            const el = document.querySelector(sel);
                            if (el) { image = el.src || el.content; if(image) break; }
                        }
                    }

                    return { title, image, price, currency };
                });

                // Post-Processing
                if (finalData.price) {
                    let p = parseFloat(finalData.price.toString().replace(/[^0-9.]/g, ''));
                    if (!isNaN(p) && p > 0) {
                        finalData.price = p;
                        break; 
                    }
                }
            } catch (e) { console.log(e.message); }
        }

        // Force INR for Indian domains
        let finalCurrency = finalData.currency;
        const currentUrl = page.url().toLowerCase();
        const indianSites = ['.in', 'flipkart', 'meesho', 'tatacliq', 'myntra', 'savana', 'quartz', 'robocraze'];
        if (indianSites.some(site => currentUrl.includes(site))) finalCurrency = 'INR';
        
        if (!finalCurrency || finalCurrency === 'INR') finalCurrency = '₹';
        else if (finalCurrency === 'USD') finalCurrency = '$';

        return {
            title: finalData.title ? finalData.title.substring(0, 100) : 'Unknown Product',
            image: finalData.image || '',
            price: finalData.price || 0,
            currency: finalCurrency
        };

    } catch (error) {
        return null;
    } finally {
        if (browser) await browser.close();
    }
}

module.exports = { scrapeProduct };