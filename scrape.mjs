import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

// Load config
const CONFIG_PATH = path.resolve('config.json');
const EXAMPLE_PATH = path.resolve('config.example.json');

let config;
if (fs.existsSync(CONFIG_PATH)) {
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
} else if (fs.existsSync(EXAMPLE_PATH)) {
  config = JSON.parse(fs.readFileSync(EXAMPLE_PATH, 'utf8'));
  console.warn('No config.json found. Using config.example.json - please copy and edit it.');
} else {
  console.error('No config.json or config.example.json found. Copy config.example.json and add your address.');
  process.exit(1);
}

const {
  address: ADDRESS,
  scanLimit = 30,
  diningMode = 'DELIVERY',
  vertical = 'restaurant',
  headless = false,
  tipScale = [5, 7, 10],
  deliveryFee = 2.99,
  serviceFeePct = 0.15,
  taxRate = 0,
  timeoutMs = 900000,
  userDataDir = path.join(process.cwd(), 'chrome-profile'),
  executablePath = ''
} = config;

const SCAN_DATE = new Date().toISOString().slice(0, 10);
const IS_PICKUP = diningMode === 'PICKUP';
const IS_GROCERY = vertical === 'grocery';

console.log('Launching Puppeteer...');

const launchOpts = {
  headless,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
};

if (userDataDir) launchOpts.userDataDir = userDataDir;
if (executablePath) launchOpts.executablePath = executablePath;

const browser = await puppeteer.launch(launchOpts);
const page = await browser.newPage();

await page.setUserAgent(
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
);

const feedUrl = IS_GROCERY
  ? `https://www.ubereats.com/feed?diningMode=${diningMode}`
  : `https://www.ubereats.com/feed?diningMode=${diningMode}`;
await page.goto(feedUrl, { waitUntil: 'networkidle0', timeout: 30000 });

// Wait for Cloudflare
let title = await page.title();
for (let i = 0; i < 10; i++) {
  if (title !== 'Just a moment...') break;
  console.log(`Waiting for Cloudflare... attempt ${i+1}`);
  try { await page.waitForFunction(() => document.title !== 'Just a moment...', { timeout: 10000 }); break; } catch {}
  title = await page.title();
}
console.log('Post-CF title:', title);
console.log('Post-CF URL:', page.url());

console.log('Setting address:', ADDRESS);
// Try multiple address input selectors for different page types
const addressSelectors = [
  'input#location-typeahead-home-input',
  'input[placeholder*="address" i]',
  'input[placeholder*="Address" i]',
  'input[placeholder*="delivery" i]',
  'input[placeholder*="Delivery" i]',
  'input[name*="address" i]',
  'input[id*="address" i]',
  'input[type="search"]'
];
let addressInput = null;
for (const sel of addressSelectors) {
  addressInput = await page.$(sel);
  if (addressInput) {
    console.log('Found address input with selector:', sel);
    break;
  }
}
if (!addressInput) {
  // Last resort: find any visible input
  const inputs = await page.$$('input[type="text"], input[type="search"], input:not([type="hidden"])');
  for (const inp of inputs) {
    const isVisible = await inp.isIntersectingViewport();
    if (isVisible) {
      addressInput = inp;
      console.log('Found visible input as fallback');
      break;
    }
  }
}
if (addressInput) {
  await addressInput.focus();
  await addressInput.type(ADDRESS, { delay: 30 });
} else {
  console.error('Could not find address input!');
  await browser.close();
  process.exit(1);
}
await new Promise(r => setTimeout(r, 3000));

const firstResult = await page.$('[data-testid*="suggestion"], [class*="suggestion"], [class*="result"], li[role="option"]');
if (firstResult) {
  await firstResult.click();
  await new Promise(r => setTimeout(r, 3000));
} else {
  await page.keyboard.press('Enter');
  await new Promise(r => setTimeout(r, 3000));
}

console.log('URL:', page.url());
console.log('Title:', await page.title());

// Wait for store grid
try {
  const selector = IS_GROCERY
    ? '[data-testid="store-card"], [class*="store-card"], [data-testid*="merchant-card"]'
    : '[data-testid="store-card"], [class*="store-card"]';
  await page.waitForSelector(selector, { timeout: 10000 });
} catch {}

let cardsEl = IS_GROCERY
  ? await page.$$('[data-testid="store-card"], [data-testid*="merchant-card"], [class*="store-card"]')
  : await page.$$('a[data-testid="store-card"]');
if (cardsEl.length === 0) cardsEl = await page.$$('[data-testid*="store-card"]');
if (cardsEl.length === 0) cardsEl = await page.$$('[class*="store-card"]');
console.log('Store cards found:', cardsEl.length);

const restaurants = [];
for (const el of cardsEl) {
  const data = await el.evaluate(e => {
    const link = e.tagName === 'A' ? e : e.querySelector('a');
    if (!link) return null;
    const href = link.href || '';
    const nameEl = e.querySelector('[data-testid="restaurant-name"], [data-testid="restaurant-title"], h1, h2, h3');
    const name = nameEl ? nameEl.textContent.trim().split('\n')[0].trim() : '';
    return { name, href };
  });
  if (data && data.href && data.href.includes('/store/') && data.name) {
    restaurants.push(data);
  }
}
console.log(`${restaurants.length} restaurants found`);

const limit = Math.min(scanLimit, restaurants.length);
const allCompiled = [];

const startTime = Date.now();

for (let i = 0; i < limit; i++) {
  const remaining = (timeoutMs - (Date.now() - startTime)) / 1000;
  if (remaining < 5) {
    console.log(`Time budget: ${remaining.toFixed(0)}s remaining, stopping.`);
    break;
  }

  const { name: restName, href: url } = restaurants[i];
  console.log(`(${i + 1}/${limit}) ${restName}...`);

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 12000 });

    let cfTitle = await page.title();
    if (cfTitle === 'Just a moment...') {
      try { await page.waitForFunction(() => document.title !== 'Just a moment...', { timeout: 8000 }); } catch {}
      cfTitle = await page.title();
    }
    await new Promise(r => setTimeout(r, 800));

    const reactData = await page.evaluate(() => {
      const el = document.querySelector('script#__REACT_QUERY_STATE__');
      return el ? el.textContent : null;
    });

    if (reactData && cfTitle !== 'Just a moment...') {
      try {
        const decoded = decodeURIComponent(JSON.parse(`"${reactData.trim()}"`));
        const data = JSON.parse(decoded);
        const parsedData = data?.queries?.[0]?.state?.data || data?.state?.data || data;

        const dealSections = (parsedData?.sections || []).filter(s => s.isOnSale);
        if (dealSections.length === 0) dealSections.push(parsedData?.sections?.[0]);

        let items = new Map();
        for (const sec of dealSections) {
          for (const { payload } of parsedData.catalogSectionsMap?.[sec.uuid] || []) {
            for (const item of payload?.standardItemsPayload?.catalogItems || []) {
              if (!items.has(item.uuid)) {
                items.set(item.uuid, item);
              }
            }
          }
        }

        // Grocery-specific: also look for items with loyaltyPrice, digitalCoupon, multiBuyPromotion
        if (IS_GROCERY) {
          for (const sec of dealSections) {
            for (const { payload } of parsedData.catalogSectionsMap?.[sec.uuid] || []) {
              for (const item of payload?.standardItemsPayload?.catalogItems || []) {
                if (!items.has(item.uuid) &&
                    (item.loyaltyPrice || item.digitalCoupon || item.multiBuyPromotion || item.unitPricePromotion)) {
                  items.set(item.uuid, item);
                }
              }
            }
          }
        }

        // Catch all deal types: BOGO, percent off, free delivery, banner promos, grocery promos
        const dealItems = Array.from(items.values()).filter(item => {
          if (item.itemPromotion) return true;
          if (item.promotion) return true;
          if (item.promotions?.length > 0) return true;
          if (item.bannerPromotion) return true;
          // Grocery-specific promotions
          if (IS_GROCERY && (item.loyaltyPrice || item.digitalCoupon || item.multiBuyPromotion || item.unitPricePromotion)) return true;
          return false;
        });

        if (dealItems.length > 0) {
          const compiled = data?.metaJson ? JSON.parse(data.metaJson) : {};
          compiled.name = restName;
          compiled.scanDate = SCAN_DATE;
          compiled.deals = dealItems.map(d => {
            const promo = d.itemPromotion || d.promotion || {};
            const buyX = promo.buyXGetYItemPromotion || {};
            const percentOff = promo.percentOffItemPromotion || {};
            const originalPrice = d.price || 0;

            let dealType = '';
            let cartCost = originalPrice;
            let savings = 0;
            let minItems = 1;

            // Grocery-specific promotions
            if (IS_GROCERY) {
              const loyalty = d.loyaltyPrice;
              const coupon = d.digitalCoupon;
              const multiBuy = d.multiBuyPromotion;
              const unitPrice = d.unitPricePromotion;

              if (loyalty && loyalty.price < originalPrice) {
                dealType = 'Loyalty Price';
                cartCost = loyalty.price;
                savings = originalPrice - loyalty.price;
              } else if (coupon && coupon.discountAmount) {
                dealType = 'Digital Coupon';
                cartCost = originalPrice - coupon.discountAmount;
                savings = coupon.discountAmount;
              } else if (multiBuy && multiBuy.quantity && multiBuy.discountPerItem) {
                dealType = 'Multi-Buy';
                minItems = multiBuy.quantity;
                cartCost = originalPrice * minItems - (multiBuy.discountPerItem * minItems);
                savings = multiBuy.discountPerItem * minItems;
              } else if (unitPrice && unitPrice.price) {
                dealType = 'Unit Price Promo';
                cartCost = unitPrice.price;
                savings = originalPrice - unitPrice.price;
              }
            }

            if (buyX && buyX.buyQuantity) {
              const buyQty = buyX.buyQuantity;
              const getQty = buyX.getQuantity || 1;

              if (buyX.buyXGetYType === 'BUY_X_GET_Y_FIXED_DISCOUNT' && buyX.fixedDiscountPerItem) {
                dealType = 'BOGO Fixed Discount';
                minItems = buyQty;
                cartCost = originalPrice * buyQty - (buyX.fixedDiscountPerItem * getQty);
                savings = buyX.fixedDiscountPerItem * getQty;
              } else if (buyX.buyXGetYType === 'BUY_X_GET_Y_PERCENT_DISCOUNT' && buyX.percentageDiscountPerItem) {
                dealType = 'BOGO Percent Off';
                minItems = buyQty;
                const discountAmt = Math.round(originalPrice * buyX.percentageDiscountPerItem / 100 * getQty);
                cartCost = originalPrice * buyQty - discountAmt;
                savings = discountAmt;
              } else {
                dealType = buyX.buyXGetYType || 'BOGO';
                minItems = buyQty;
                cartCost = originalPrice * buyQty;
                savings = originalPrice * getQty;
              }
            } else if (percentOff && percentOff.percentageDiscount) {
              dealType = 'Percent Off';
              minItems = 1;
              const discountAmt = Math.round(originalPrice * percentOff.percentageDiscount / 100);
              cartCost = originalPrice - discountAmt;
              savings = discountAmt;
            }

            // All math in cents for consistency
            const cartCostCents = Math.max(0, cartCost);
            const serviceFeeCents = Math.round(cartCostCents * serviceFeePct);
            const subtotalTaxCents = Math.round(cartCostCents * taxRate);
            const deliveryFeeCents = IS_PICKUP ? 0 : Math.round(deliveryFee * 100);
            const totalBeforeTipCents = cartCostCents + deliveryFeeCents + serviceFeeCents + subtotalTaxCents;

            const totalsWithTips = tipScale.map(tip => ({
              label: `$${tip} tip`,
              total: totalBeforeTipCents + tip * 100
            }));

            return {
              title: d.title || d.itemName || '',
              price: originalPrice,
              priceDisplay: `$${(originalPrice / 100).toFixed(2)}`,
              promoLabel: d.promoInfo?.promoInfoLabel?.accessibilityText || '',
              imageUrl: d.imageUrl || '',
              dealType: dealType,
              minItems: minItems,
              cartCost: cartCostCents,
              savings: Math.max(0, savings),
              savingsDisplay: `$${(Math.max(0, savings) / 100).toFixed(2)}`,
              deliveryFee: deliveryFeeCents,
              serviceFee: serviceFeeCents,
              subtotalTax: subtotalTaxCents,
              subtotal: cartCostCents,
              totalsWithTips: totalsWithTips
            };
          });
          compiled.bestDealPrice = Math.min(...dealItems.map(d => d.price || 99999));
          compiled.bestDealTitle = dealItems.reduce((a, b) => (a.price || 99999) < (b.price || 99999) ? a : b).title;
          delete compiled.hasMenu;
          allCompiled.push(compiled);
          // Write incrementally so we keep data even on timeout
          fs.writeFileSync('scraped.json', JSON.stringify(allCompiled, null, 2));
          console.log(`  got ${dealItems.length} deal(s), best price: $${(compiled.bestDealPrice / 100).toFixed(2)}`);
        } else {
          console.log(`  no deals for ${restName}`);
        }
      } catch (err) {
        console.log(`  parse error: ${err.message}`);
      }
    }

  } catch (err) {
    console.log(`  error: ${err.message}`);
  }

  if (i < limit - 1) {
    await new Promise(r => setTimeout(r, 2000));
  }
}

await browser.close();

fs.writeFileSync('scraped.json', JSON.stringify(allCompiled, null, 2));
console.log(`\nWrote ${allCompiled.length} restaurants with deals to scraped.json`);

if (allCompiled.length > 0) {
  console.log('\n=== BEST DEALS ===');
  const sorted = allCompiled.sort((a, b) => a.bestDealPrice - b.bestDealPrice);
  for (const r of sorted.slice(0, 10)) {
    console.log(`  ${r.name}: $${(r.bestDealPrice / 100).toFixed(2)} - ${r.bestDealTitle}`);
  }
  console.log('\n=== DEAL DETAILS ===');
  for (const r of sorted) {
    console.log(`\n${r.name} (${r.deals.length} deals):`);
    for (const d of r.deals.sort((a, b) => a.cartCost - b.cartCost).slice(0, 5)) {
      console.log(`  ${d.title}:`);
      console.log(`    Deal: ${d.dealType}`);
      console.log(`    Min items: ${d.minItems}`);
      console.log(`    Cart cost: $${(d.cartCost / 100).toFixed(2)}`);
      console.log(`    Delivery: $${(d.deliveryFee / 100).toFixed(2)}, Service: $${(d.serviceFee / 100).toFixed(2)}, Tax: $${(d.subtotalTax / 100).toFixed(2)}`);
      console.log(`    Subtotal: $${(d.subtotal / 100).toFixed(2)}`);
      console.log(`    Totals with tips:`);
      d.totalsWithTips.forEach(tip => {
        console.log(`      ${tip.label}: $${(tip.total / 100).toFixed(2)}`);
      });
    }
  }
}