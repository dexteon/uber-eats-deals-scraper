# UberEats Deals Scraper

A Node.js + Puppeteer tool that visits the UberEats pickup feed for your address, scans restaurant stores, extracts active promotions (BOGO, percent-off, banner promos), calculates full cart costs including service fee, tax, and optional tips, and writes a portable `scraped.json` consumed by a static dashboard.

![Dashboard](docs/dashboard.png)

---

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/your-username/uber-eats-deals-scraper.git
cd uber-eats-deals-scraper
npm install

# 2. Configure your address
cp config.example.json config.json
# Edit config.json with your delivery address

# 3. Run once
npm run scrape

# 4. View results
open playgrounds/uber-eats-deals.html
# or serve the playgrounds folder with any static server
```

---

## Configuration

Create `config.json` from the example (never commit real addresses):

```json
{
  "address": "YOUR_DELIVERY_ADDRESS_HERE",
  "scanLimit": 30,
  "diningMode": "PICKUP",
  "headless": true,
  "tipScale": [5, 7, 10],
  "deliveryFee": 0,
  "serviceFeePct": 0.15,
  "taxRate": 0,
  "timeoutMs": 900000,
  "userDataDir": "",
  "executablePath": ""
}
```

| Key | Purpose |
|-----|---------|
| `address` | Full street address UberEats accepts (street, city, state, ZIP) |
| `scanLimit` | Max restaurants to visit per run (default 30, fits in ~7 minutes) |
| `diningMode` | `PICKUP` or `DELIVERY` — affects delivery fee math |
| `headless` | Puppeteer headless mode (`true` for background, `false` for debugging) |
| `tipScale` | Tip amounts in whole dollars shown in the dashboard |
| `deliveryFee` | Flat delivery fee in dollars (ignored for PICKUP) |
| `serviceFeePct` | Service fee percentage of cart subtotal (default 0.15 = 15%) |
| `taxRate` | Tax rate as decimal (default 0 — set your local rate) |
| `timeoutMs` | Global time budget for the run (default 900000 = 15 minutes) |
| `userDataDir` | Optional Chrome profile path for logged-in coupons (cannot be open in Chrome simultaneously) |
| `executablePath` | Optional Chrome/Chromium binary if using a specific browser |

---

## What It Scrapes

1. **Feed page** — loads `https://www.ubereats.com/feed?diningMode=PICKUP`, types the address into the typeahead, selects the first suggestion
2. **Restaurant cards** — collects up to `scanLimit` store links via `a[data-testid="store-card"]`
3. **Store page** — navigates each store URL, waits for Cloudflare challenge to clear (max 8s), reads the embedded `__REACT_QUERY_STATE__` script tag
4. **Promotion extraction** — from the parsed React state finds items that have any of:
   - `itemPromotion`
   - `promotion`
   - `promotions[]` (array)
   - `bannerPromotion`
5. **Deal classification** — each matched item is classified as:
   - BOGO Fixed Discount
   - BOGO Percent Off
   - BOGO (generic fallback)
   - Percent Off
6. **Cart math** (all values in cents internally for precision):
   - `cartCost` — discounted item subtotal for minimum quantity
   - `deliveryFee` — flat fee in cents (0 for PICKUP)
   - `serviceFee` — `serviceFeePct * cartCost`
   - `tax` — `taxRate * cartCost`
   - `totalsWithTips` — cart + fees + tax + each tip option

---

## Output: `scraped.json`

```json
[
  {
    "name": "Restaurant Name",
    "scanDate": "2026-11-01",
    "deals": [
      {
        "title": "Gyros",
        "price": 1699,
        "priceDisplay": "$16.99",
        "promoLabel": "Buy 1 Get 1 Free",
        "imageUrl": "https://...",
        "dealType": "BOGO",
        "minItems": 1,
        "cartCost": 1699,
        "savings": 1699,
        "savingsDisplay": "$16.99",
        "deliveryFee": 0,
        "serviceFee": 255,
        "subtotalTax": 0,
        "subtotal": 1699,
        "totalsWithTips": [
          { "label": "$5 tip", "total": 2454 },
          { "label": "$7 tip", "total": 2654 },
          { "label": "$10 tip", "total": 2954 }
        ]
      }
    ],
    "bestDealPrice": 1699,
    "bestDealTitle": "Gyros"
  }
]
```

All monetary fields are in **cents** except `priceDisplay` and `savingsDisplay` which are formatted strings.

---

## Dashboard (Playground)

Static page at `playgrounds/uber-eats-deals.html`:

- Fetches `./scraped.json` (must sit next to the HTML)
- Tabler CSS theme (CDN), dark-mode ready
- Stats tiles: restaurant count, total deals, best price
- Search + sort (price, deal count, A-Z)
- Accordion per restaurant, each deal card shows:
  - Deal badge, minimum items, cart cost
  - Line-item breakdown: deal type, delivery, service fee, tax, TOTAL
  - Tip scale rows ($5/$7/$10)
- Scan date badge in header

Deploy by copying the `playgrounds/` folder to any static host (GitHub Pages, Netlify, Apache, Nginx).

---

## Scheduling

### Windows (Task Scheduler)

```bat
schtasks /create /tn "UberEats-Scraper" /tr "C:\path\uber-eats-deals-scraper\run_scrape.bat" /sc hourly /mo 4 /st 06:00 /f
```

Create `run_scrape.bat` in the project root:

```bat
@echo off
cd /d %~dp0
npm run scrape > scrape.log 2>&1
copy scraped.json playgrounds\scraped.json
```

### macOS / Linux (cron)

```bash
# Every 4 hours
0 */4 * * * cd /path/to/uber-eats-deals-scraper && npm run scrape >> scrape.log 2>&1 && cp scraped.json playgrounds/scraped.json
```

Health check (run anytime):

```bash
npm run check
```

Verifies `scraped.json` age (< 8h = fresh) and portal data sync.

---

## Requirements

- Node.js 18+ (Puppeteer bundles its own Chromium)
- Windows, macOS, or Linux
- Network access to `ubereats.com`
- Optional: logged-in Chrome profile for personalized coupons — set `userDataDir` in config. The profile **cannot be open in Chrome at the same time**.

---

## Limitations and Gotchas

- **ToS warning**: Uber Eats Terms of Service prohibit automated scraping. This tool is for personal, rate-limited use only. No affiliation with Uber. Use at your own risk — your account may be banned. No warranty provided.
- **Cloudflare**: store pages sometimes serve a "Just a moment..." challenge. Puppeteer waits up to 8s; if it doesn't clear, the restaurant is skipped.
- **Selectors break** when Uber changes markup (`__REACT_QUERY_STATE__`, `a[data-testid="store-card"]`).
- **Rate**: 2s delay between stores; 30 stores takes ~7 minutes. Increase `scanLimit` only if you raise `timeoutMs`.
- **Deal availability**: highly variable. A run may find 0–5 restaurants with active promos.
- **Address format**: must match what UberEats' typeahead returns. Test manually once before automating.
- **User-Agent**: spoofed Chrome 120 on Windows while running bundled Chromium with `--no-sandbox`.
- **No DoorDash**: DoorDash's Cloudflare is stricter and consistently times out in headless/remote contexts.

---

## Extending

- Add deal types: inspect `item.promotion` shapes in the React state and extend `classifyDeal()` in `scrape.mjs`.
- Different markets: change `taxRate`, `deliveryFee`, `serviceFeePct` in config.
- Persistence: swap `fs.writeFileSync` for SQLite or append-only log for history.
- Alerts: hook `health_check.mjs` to email/Telegram when data goes stale.

---

## License

MIT License — see [LICENSE](LICENSE) for details.

**Note**: Never commit real addresses or API keys. `config.json` is gitignored; ship only `config.example.json`.

---

[cyberautomations.com](https://cyberautomations.com/?utm_source=github&utm_medium=readme&utm_campaign=uber-eats-deals-scraper)