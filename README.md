# UberEats Deals Scraper

A Node.js and Puppeteer tool that loads the UberEats feed for your address, visits restaurant store pages, and pulls out active promotions (BOGO, percent off, banner promos). For each deal it works out the full cart cost, including service fee, tax, and optional tips, and writes the result to `scraped.json`. A static dashboard in `playgrounds/` reads that file.

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
cp scraped.json playgrounds/scraped.json
# Serve the playgrounds folder with any static server and open uber-eats-deals.html
```

---

## Configuration

Create `config.json` from the example. It is gitignored, so your address stays local.

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
| `address` | Full street address that UberEats accepts (street, city, state, ZIP) |
| `scanLimit` | Maximum restaurants to visit per run (default 30) |
| `diningMode` | `PICKUP` or `DELIVERY`. Sets the feed URL; the delivery fee is only applied for `DELIVERY` |
| `headless` | Puppeteer headless mode (`true` for background runs, `false` for debugging) |
| `tipScale` | Tip amounts in whole dollars, shown in the dashboard |
| `deliveryFee` | Flat delivery fee in dollars (ignored for `PICKUP`) |
| `serviceFeePct` | Service fee as a fraction of the cart subtotal (default 0.15 = 15%) |
| `taxRate` | Tax rate as a decimal (default 0; set your local rate) |
| `timeoutMs` | Time budget for the whole run (default 900000 = 15 minutes) |
| `userDataDir` | Optional Chrome profile path, for logged-in coupons. The profile cannot be open in Chrome at the same time |
| `executablePath` | Optional path to a specific Chrome or Chromium binary |

---

## How It Works

1. **Feed page.** Loads `https://www.ubereats.com/feed?diningMode=<diningMode>`, types the address into the typeahead, and selects the first suggestion.
2. **Restaurant cards.** Collects up to `scanLimit` store links from `a[data-testid="store-card"]`.
3. **Store page.** Opens each store URL, waits up to 8 seconds for a Cloudflare challenge to clear, and reads the embedded `__REACT_QUERY_STATE__` script tag.
4. **Promotion extraction.** Keeps items in the parsed state that have any of `itemPromotion`, `promotion`, a non-empty `promotions[]`, or `bannerPromotion`.
5. **Deal classification.** Each match is labeled as one of:
   - BOGO Fixed Discount
   - BOGO Percent Off
   - BOGO (generic fallback)
   - Percent Off
6. **Cart math.** All values are integer cents:
   - `cartCost`: discounted item subtotal for the minimum quantity
   - `deliveryFee`: flat fee (0 for `PICKUP`)
   - `serviceFee`: `serviceFeePct * cartCost`
   - `subtotalTax`: `taxRate * cartCost`
   - `totalsWithTips`: cart cost plus fees and tax, plus each tip option

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

Monetary fields are in cents, except `priceDisplay` and `savingsDisplay`, which are formatted strings.

---

## Dashboard

`playgrounds/uber-eats-deals.html` is a static page that:

- Fetches `./scraped.json`, which must sit next to the HTML file
- Uses the Tabler CSS theme from a CDN, in dark mode
- Shows search and sort (lowest price, most deals, A-Z)
- Lists one accordion per restaurant, with a card per deal showing the deal badge, minimum items, cart cost, fee and tax breakdown, total, and the tip scale rows
- Shows the scan date in the header

To deploy, copy the `playgrounds/` folder (with a fresh `scraped.json`) to any static host.

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

### macOS and Linux (cron)

```bash
# Every 4 hours
0 */4 * * * cd /path/to/uber-eats-deals-scraper && npm run scrape >> scrape.log 2>&1 && cp scraped.json playgrounds/scraped.json
```

### Health check

```bash
npm run check
```

Reports the age of `scraped.json` (a warning past 8 hours), prints restaurant and deal counts, and compares them with `playgrounds/scraped.json` if that copy exists.

---

## Requirements

- Node.js 18 or newer (Puppeteer downloads its own Chromium)
- Windows, macOS, or Linux
- Network access to `ubereats.com`

---

## Limitations

- **Terms of service.** Uber Eats terms prohibit automated scraping. Use this tool only for personal, low-volume runs. It has no affiliation with Uber, comes with no warranty, and your account may be banned.
- **Cloudflare.** Store pages sometimes show a "Just a moment..." challenge. If it does not clear within 8 seconds, that restaurant is skipped.
- **Selectors break** when Uber changes its markup (`__REACT_QUERY_STATE__`, `a[data-testid="store-card"]`).
- **Pacing.** The scraper waits 2 seconds between stores. Raise `timeoutMs` if you raise `scanLimit`.
- **Deal availability varies.** A run may find anywhere from zero to a handful of restaurants with active promos.
- **Address format.** It must match what the UberEats typeahead returns. Test it by hand once before automating.
- **Browser fingerprint.** The scraper sets a Chrome 120 on Windows user agent while running the bundled Chromium with `--no-sandbox`.
- **No DoorDash support.** DoorDash's Cloudflare checks were stricter and timed out in headless runs.

---

## Extending

- Add deal types: inspect the `item.promotion` shapes in the React state and extend the deal type branches inside the `compiled.deals` map in `scrape.mjs`.
- Other markets: change `taxRate`, `deliveryFee`, and `serviceFeePct` in the config.
- History: replace `fs.writeFileSync` with SQLite or an append-only log.
- Alerts: hook `health_check.mjs` to email or Telegram when data goes stale.

---

## License

MIT. See [LICENSE](LICENSE).

<!-- ca-tracked-link -->
[cyberautomations.com](https://cyberautomations.com/?utm_source=github&utm_medium=readme&utm_campaign=uber-eats-deals-scraper)
