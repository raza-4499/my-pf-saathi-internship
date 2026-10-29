const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({
    headless: false,
  });

  const page = await browser.newPage();

  await page.goto(
    "https://unifiedportal-mem.epfindia.gov.in/memberinterface/",
    {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    }
  );

  console.log("EPFO page opened successfully");

  // Browser intentionally open rakha hai
})();