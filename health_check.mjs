import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCRAPED_JSON = path.resolve(__dirname, 'scraped.json');
const PORTAL_JSON = path.resolve(__dirname, 'playgrounds', 'scraped.json');
const MAX_AGE_HOURS = 8;

console.log('=== UberEats scraper health check ===');

if (!fs.existsSync(SCRAPED_JSON)) {
  console.log('FAIL: scraped.json not found at project root');
  process.exit(1);
}

const stat = fs.statSync(SCRAPED_JSON);
const ageHours = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60);
console.log(`scraped.json age: ${ageHours.toFixed(1)} hours`);

if (ageHours > MAX_AGE_HOURS) {
  console.log(`WARN: Data is ${ageHours.toFixed(1)}h old (max ${MAX_AGE_HOURS}h)`);
} else {
  console.log('OK: Data is fresh');
}

let data;
try {
  data = JSON.parse(fs.readFileSync(SCRAPED_JSON, 'utf8'));
} catch (e) {
  console.log('FAIL: scraped.json is not valid JSON');
  process.exit(1);
}

const restaurantCount = data.length;
const totalDeals = data.reduce((sum, r) => sum + (r.deals?.length || 0), 0);
const bestPrice = data.reduce((min, r) => Math.min(min, r.bestDealPrice || Infinity), Infinity);
console.log(`DATA: ${restaurantCount} restaurants, ${totalDeals} total deals, best ${bestPrice < Infinity ? '$' + (bestPrice / 100).toFixed(2) : 'N/A'}`);

if (fs.existsSync(PORTAL_JSON)) {
  let portalData;
  try {
    portalData = JSON.parse(fs.readFileSync(PORTAL_JSON, 'utf8'));
  } catch {
    console.log('WARN: playgrounds/scraped.json exists but is invalid JSON');
  }
  if (portalData) {
    const portalCount = portalData.length;
    const portalDeals = portalData.reduce((sum, r) => sum + (r.deals?.length || 0), 0);
    if (portalCount === restaurantCount && portalDeals === totalDeals) {
      console.log('OK: Portal data matches source');
    } else {
      console.log(`WARN: Portal out of sync (portal: ${portalCount} restaurants, ${portalDeals} deals)`);
    }
  }
} else {
  console.log('INFO: playgrounds/scraped.json not found (run deploy to copy)');
}

console.log('=== Done ===');