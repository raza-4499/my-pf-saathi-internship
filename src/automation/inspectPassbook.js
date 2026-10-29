const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({
    headless: false,
  });

  const page = await browser.newPage();

  await page.goto(
    "https://passbook.epfindia.gov.in/MemberPassBook/login",
    {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    }
  );

  await page.waitForTimeout(3000);

  console.log("\n===== INPUT FIELDS =====");

  const inputs = await page.locator("input").evaluateAll((elements) =>
    elements.map((el) => ({
      type: el.type,
      id: el.id,
      name: el.name,
      placeholder: el.placeholder,
      className: el.className,
    }))
  );

  console.log(inputs);

  console.log("\n===== IMAGES =====");

  const images = await page.locator("img").evaluateAll((elements) =>
    elements.map((el) => ({
      id: el.id,
      src: el.src,
      alt: el.alt,
      className: el.className,
    }))
  );

  console.log(images);

  console.log("\n===== BUTTONS =====");

  const buttons = await page
    .locator("button, input[type='submit']")
    .evaluateAll((elements) =>
      elements.map((el) => ({
        tag: el.tagName,
        id: el.id,
        type: el.type,
        text: el.innerText || el.value,
        className: el.className,
      }))
    );

  console.log(buttons);

  console.log("\nInspection complete. Browser intentionally left open.");
})();