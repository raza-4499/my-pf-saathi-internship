const { chromium } = require("playwright");

const PASSBOOK_URL =
  "https://passbook.epfindia.gov.in/MemberPassBook/login";


async function createPassbookSession(uan, password) {
  const browser = await chromium.launch({
    headless: false,
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(PASSBOOK_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  await page.waitForSelector("#username", {
    state: "visible",
    timeout: 60000,
  });

  await page.locator("#username").fill(uan);
  await page.locator("#password").fill(password);

  const captchaBuffer = await getCaptcha(page);

  return {
    browser,
    context,
    page,
    captchaBuffer,
  };
}


async function getCaptcha(page) {
  await page.waitForSelector("#captcha_id", {
    state: "visible",
    timeout: 30000,
  });

  return await page.locator("#captcha_id").screenshot();
}


async function retryPassword(session, password) {
  const { page } = session;

  await page.waitForSelector("#password", {
    state: "visible",
    timeout: 30000,
  });

  await page.locator("#password").fill(password);

  const captchaBuffer = await getCaptcha(page);

  return captchaBuffer;
}


async function submitCaptcha(session, captchaText) {
  const { page } = session;

  await page.locator("#captcha").fill(captchaText);

  await page.locator("#login").click();

  await page.waitForTimeout(3000);

  const currentUrl = page.url();

  // If login form is still visible, login was not successful.
  const loginFormStillVisible = await page
    .locator("#username")
    .isVisible()
    .catch(() => false);

  if (loginFormStillVisible) {
    const bodyText = await page.locator("body").innerText();

    const lowerText = bodyText.toLowerCase();

    if (
      lowerText.includes("invalid captcha") ||
      lowerText.includes("captcha does not match") ||
      lowerText.includes("incorrect captcha")
    ) {
      return {
        success: false,
        reason: "captcha",
        captchaBuffer: await getCaptcha(page),
      };
    }

    if (
      lowerText.includes("invalid password") ||
      lowerText.includes("invalid uan") ||
      lowerText.includes("uan or password") ||
      lowerText.includes("wrong password")
    ) {
      return {
        success: false,
        reason: "credentials",
      };
    }

    return {
      success: false,
      reason: "login_failed",
    };
  }

  return {
    success: true,
    url: currentUrl,
  };
}


async function closePassbookSession(session) {
  if (!session) return;

  try {
    await session.browser.close();
  } catch (error) {
    // Ignore cleanup errors
  }
}


module.exports = {
  createPassbookSession,
  retryPassword,
  submitCaptcha,
  closePassbookSession,
};