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
                '--disable-blink-features=AutomationControlled'
            ]
        });

        const page = await browser.newPage();
        
        // STEALTH HEADERS
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://www.google.com/',
            'Upgrade-Insecure-Requests': '1'
        });

        await page.setViewport({ width: 1366, height: 768 });

        let attempts = 0;
        let finalData = { title: 'Unknown', image: '', price: 0, currency: '$' };

        // --- RETRY LOOP (The "Double Tap" Fix) ---
        while (attempts < 2) {
            attempts++;
            try {
                console.log(`Attempt ${attempts} for ${url}...`);
                
                // 1. NAVIGATE
                if (attempts === 1) {
                    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
                } else {
                    console.log("Price not found. Reloading page...");
                    await page.reload({ waitUntil: 'networkidle2' });
                }

                // 2. AUTO-SCROLL
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

                // 3. EXTRACTION
                finalData = await page.evaluate(() => {
                    let title = document.title;
                    let image = "";
                    let price = 0;
                    let currency = null;

                    // META TAGS
                    const metaPrice = document.querySelector('meta[property="product:price:amount"]')?.content ||
                                      document.querySelector('meta[property="og:price:amount"]')?.content;
                    if (metaPrice) price = metaPrice;

                    const metaCurrency = document.querySelector('meta[property="product:price:currency"]')?.content ||
                                         document.querySelector('meta[property="og:price:currency"]')?.content;
                    if (metaCurrency) currency = metaCurrency;

                    const metaImage = document.querySelector('meta[property="og:image"]')?.content;
                    if (metaImage) image = metaImage;

                    // VISUAL SELECTORS (Updated for Flipkart)
                    if (!price || price === 0) {
                        const selectors = [
                            // Flipkart Specific
                            'div._30jeq3._16Jk6d', 'div._30jeq3', '.CEmiEU ._30jeq3',
                            // Tata / Savana / Others
                            '.ProductDescriptionPage__price', '.product-price-value', 
                            '#ProductPrice', '.price-item--regular', '.price__current',
                            'h4[color="greyBase"]', '.ProductDescription__PriceText-sc-17crh2v-0 h4',
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
                        const imgSelectors = ['img._396cs4', '.product__media img', '.swiper-slide-active img', '#landingImage'];
                        for (let sel of imgSelectors) {
                            const el = document.querySelector(sel);
                            if (el) { image = el.src || el.content; if(image) break; }
                        }
                    }

                    return { title, image, price, currency };
                });

                // Clean Price
                if (finalData.price) {
                    let p = parseFloat(finalData.price.toString().replace(/[^0-9.]/g, ''));
                    if (!isNaN(p) && p > 0) {
                        finalData.price = p;
                        break; // SUCCESS! Exit retry loop
                    }
                }
                
                // If price is still 0, loop will retry
                
            } catch (e) {
                console.log("Error during attempt:", e.message);
            }
        }

        // --- DEBUGGING ---
        if (!finalData.price || finalData.price === 0) {
            try {
                const domain = new URL(url).hostname.replace('www.', '');
                const debugPath = path.resolve(__dirname, '../client/dist/debug.png');
                await page.screenshot({ path: debugPath, fullPage: false });
                console.log(`📸 Debug screenshot saved to ${debugPath}`);
            } catch (e) {}
        }

        // FORCE INR
        let finalCurrency = finalData.currency;
        const currentUrl = page.url().toLowerCase();
        const indianSites = ['.in', 'flipkart', 'meesho', 'tatacliq', 'myntra', 'ajio', 'quartzcomponents', 'robocraze', 'savana', 'silverline'];

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