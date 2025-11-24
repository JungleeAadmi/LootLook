const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Add stealth plugin to hide that we are a bot
puppeteer.use(StealthPlugin());

async function scrapeProduct(url) {
    let browser;
    try {
        // Launch the hidden browser
        browser = await puppeteer.launch({
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox'] // Required for LXC/Root
        });

        const page = await browser.newPage();

        // Set a realistic viewport size
        await page.setViewport({ width: 1366, height: 768 });

        // Go to the URL and wait for the network to be idle (page fully loaded)
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        // Extract Data using page evaluation
        const data = await page.evaluate(() => {
            // Helpers
            const getText = (sel) => document.querySelector(sel)?.innerText?.trim();
            const getAttr = (sel, attr) => document.querySelector(sel)?.getAttribute(attr);

            // 1. Get Title
            const title = 
                getAttr('meta[property="og:title"]', 'content') || 
                getText('h1') || 
                document.title;

            // 2. Get Image
            const image = 
                getAttr('meta[property="og:image"]', 'content') || 
                getAttr('.wp-post-image', 'src') || // Common WordPress/WooCommerce (Robu.in)
                getAttr('#imgTagWrapperId img', 'src'); // Amazon

            // 3. Get Price (Try multiple selectors)
            let priceText = 
                getText('.price') ||                 // Generic / WooCommerce
                getText('.a-price .a-offscreen') ||  // Amazon
                getText('[itemprop="price"]') ||     // Schema
                getText('.product-price');

            return { title, image, priceText };
        });

        // Clean Price Logic
        let price = 0;
        if (data.priceText) {
            // Remove currency symbols, commas, and letters
            const cleanString = data.priceText.replace(/[^0-9.]/g, '');
            price = parseFloat(cleanString);
        }

        return {
            title: data.title || 'Unknown Item',
            image: data.image || '',
            price: isNaN(price) ? 0 : price
        };

    } catch (error) {
        console.error(`Failed to scrape ${url}:`, error.message);
        return null;
    } finally {
        if (browser) await browser.close();
    }
}

module.exports = { scrapeProduct };
