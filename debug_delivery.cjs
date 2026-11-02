const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({headless: true, args: ['--no-sandbox']});
  const page = await browser.newPage();
  await page.goto('https://www.ubereats.com/feed?diningMode=DELIVERY', {waitUntil: 'networkidle0', timeout: 30000});
  
  // Wait for Cloudflare to clear
  let title = await page.title();
  console.log('Initial title:', title);
  
  for (let i = 0; i < 10; i++) {
    if (title !== 'Just a moment...') break;
    console.log(`Waiting for Cloudflare... attempt ${i+1}`);
    await new Promise(r => setTimeout(r, 5000));
    title = await page.title();
    console.log('Title:', title);
  }
  
  console.log('Final title:', await page.title());
  console.log('Final URL:', page.url());
  
  const inputs = await page.$$eval('input', els => els.map(e => ({
    type: e.type,
    placeholder: e.placeholder,
    name: e.name,
    id: e.id,
    class: e.className,
    visible: e.offsetParent !== null
  })));
  console.log('Inputs:', JSON.stringify(inputs, null, 2));
  
  await browser.close();
})();