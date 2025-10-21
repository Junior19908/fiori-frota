/*
  Headless runner for UI5 QUnit tests.
  Usage: node scripts/run-qunit-headless.js http://localhost:8888/test/testsuite.qunit.html
*/
const http = require('http');

(async () => {
  const url = process.argv[2];
  if (!url) {
    console.error('Missing URL. Example: node scripts/run-qunit-headless.js http://localhost:8888/test/testsuite.qunit.html');
    process.exit(2);
  }
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox','--disable-gpu'] });
  const page = await browser.newPage();
  page.setDefaultTimeout(120000);

  let donePayload = null;
  await page.exposeFunction('___onQUnitDone', (details) => { donePayload = details; });

  await page.goto(url, { waitUntil: 'networkidle2' });

  // Attach QUnit.done hook (if QUnit already loaded, this still fires at end)
  await page.evaluate(() => {
    (function monitor(){
      function attach() {
        if (window.QUnit && typeof window.QUnit.done === 'function') {
          try { window.QUnit.done(function (d) { window.___onQUnitDone(d); }); } catch (e) {}
          return true;
        }
        return false;
      }
      if (!attach()) setTimeout(monitor, 200);
    })();
  });

  // Wait until QUnit reports done (poll for up to 3 minutes)
  const start = Date.now();
  while (!donePayload && Date.now() - start < 180000) {
    await new Promise(r => setTimeout(r, 500));
  }

  if (!donePayload) {
    // try to read result banner as fallback
    let text = '';
    try { text = await page.$eval('#qunit-testresult', el => el && el.textContent || ''); } catch(_) {}
    console.error('Timed out waiting QUnit.done. Banner:', text || '(no banner)');
    await browser.close();
    process.exit(3);
  }

  const { failed, passed, total, runtime } = donePayload;
  const summary = `QUnit: total=${total} passed=${passed} failed=${failed} runtime=${runtime}ms`;
  console.log(summary);

  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
})();
