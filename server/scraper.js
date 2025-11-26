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
                '--disable-blink-features=AutomationControlled',
                '--disable-features=IsolateOrigins,site-per-process' 
            ]
        });

        const page = await browser.newPage();
        
        // 1. FINGERPRINTING (Look Human)
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Referer': 'https://www.google.com/', 
            'Upgrade-Insecure-Requests': '1'
        });

        await page.setViewport({ width: 1366, height: 768 });
        
        // 2. SMART NAVIGATION (Handle Redirects)
        // If it's a short link, we increase timeout and wait for the URL to resolve
        const isShortLink = url.includes('dl.flipkart') || url.includes('sharein') || url.includes('amzn.in');
        const navTimeout = isShortLink ? 90000 : 60000;

        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: navTimeout });
            
            // REDIRECT CHASER: If URL is still a short link, wait for it to change
            if (isShortLink) {
                try {
                    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 });
                } catch(e) { console.log("Redirect wait timeout, proceeding..."); }
            }
        } catch (e) {
            console.log(`Navigation issue on ${url}, trying to scrape anyway...`);
        }
        
        // 3. HUMAN BEHAVIOR (Scroll & Mouse)
        // TataCliq checks for mouse movement
        try {
            await page.mouse.move(100, 100);
            await page.mouse.down();
            await page.mouse.up();
        } catch(e){}

        // Auto-Scroll to trigger lazy load
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
                }, 100);
            });
        });
        
        await wait(3000); // Wait for JS to finish

        // 4. DATA EXTRACTION
        const data = await page.evaluate(() => {
            let title = document.title;
            let image = "";
            let price = 0;
            let currency = null;

            // --- STRATEGY 1: JSON-LD (Hidden Data) ---
            const scripts = document.querySelectorAll('script[type="application/ld+json"]');
            for (let script of scripts) {
                try {
                    const json = JSON.parse(script.innerText);
                    // Handle array or single object
                    const nodes = Array.isArray(json) ? json : [json];
                    const product = nodes.find(i => i['@type'] === 'Product');
                    
                    if (product) {
                        if (product.name) title = product.name;
                        if (!image && product.image) {
                            image = Array.isArray(product.image) ? product.image[0] : product.image;
                        }
                        
                        const offers = Array.isArray(product.offers) ? product.offers : [product.offers];
                        const offer = offers.find(o => o && o.price);
                        if (offer) {
                            price = offer.price;
                            currency = offer.priceCurrency;
                        }
                    }
                } catch (e) {}
            }

            // --- STRATEGY 2: VISUAL SELECTORS ---
            if (!price || price === 0) {
                const selectors = [
                    // TATA CLIQ
                    '.ProductDetailsMainCard__price h3', '.ProductDescriptionPage__price',
                    // SAVANA
                    '.product-price-value',
                    // MEESHO
                    'h4[color="greyBase"]', '.ProductDescription__PriceText-sc-17crh2v-0 h4',
                    // FLIPKART
                    '._30jeq3', '._30jeq3._16Jk6d',
                    // GENERIC / SHOPIFY
                    '#ProductPrice', '.price__current', '.product-price', '.price', '.money', 'bdi'
                ];
                
                for (let sel of selectors) {
                    const el = document.querySelector(sel);
                    if (el && el.innerText.match(/[0-9]/)) {
                        const txt = el.innerText;
                        if(txt.length < 30) {
                            price = txt;
                            // Try to detect currency from text
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
                    '.ProductDetailsMainCard__galleryImage img', // TataCliq
                    'div[data-testid="product-image"] img', // Meesho
                    '.swiper-slide-active img', // Savana
                    'img._396cs4', // Flipkart
                    '.product__media img' // Shopify
                ];
                for (let sel of imgSelectors) {
                    const el = document.querySelector(sel);
                    if (el) { image = el.src || el.content; if(image) break; }
                }
            }

            return { title, image, price, currency };
        });

        // --- POST PROCESSING ---
        let finalPrice = 0;
        if (data.price) {
            finalPrice = parseFloat(data.price.toString().replace(/[^0-9.]/g, ''));
        }

        // --- CURRENCY NORMALIZATION ---
        let finalCurrency = data.currency;
        const currentUrl = page.url().toLowerCase();
        
        const indianDomains = ['flipkart', 'meesho', 'tatacliq', 'myntra', 'ajio', 'robocraze', 'savana', 'quartzcomponents', '.in'];
        
        if (