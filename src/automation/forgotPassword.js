const { chromium } = require("playwright");

const EPFO_MEMBER_URL =
  "https://unifiedportal-mem.epfindia.gov.in/memberinterface/";


// ======================================================
// EPFO SECURITY POPUP
// ======================================================

async function closeSecurityAlert(page) {
  const okButton = page
    .getByRole("button", { name: /^Ok$/i })
    .first();

  try {
    await okButton.waitFor({
      state: "visible",
      timeout: 7000,
    });

    await okButton.click();

    await page.waitForTimeout(700);

    console.log(">>> EPFO SECURITY ALERT CLOSED");
  } catch (error) {
    // Popup nahi aaya to normal hai
  }
}


// ======================================================
// CHECK EPFO ERROR PAGE
// ======================================================

async function isEpfoErrorPage(page) {
  if (/error\.jsp/i.test(page.url())) {
    return true;
  }

  const bodyText = await page
    .locator("body")
    .innerText()
    .catch(() => "");

  return /unexpected error has occured/i.test(
    bodyText
  );
}


// ======================================================
// RETURN TO EPFO HOME AFTER NETWORK ERROR
// ======================================================

async function recoverFromErrorPage(page) {
  const clickHere = page
    .getByRole("link", {
      name: /click here/i,
    })
    .first();

  if (
    await clickHere
      .isVisible()
      .catch(() => false)
  ) {
    await clickHere.click();

    await page.waitForLoadState(
      "domcontentloaded"
    );

    await page.waitForTimeout(1000);

    return;
  }

  await page.goto(EPFO_MEMBER_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  await page.waitForTimeout(1000);
}


// ======================================================
// OPEN FORGOT PASSWORD PAGE
// ======================================================

async function openForgotPasswordPage(
  page,
  onNetworkRetry = async () => {}
) {
  const MAX_ATTEMPTS = 3;

  for (
    let attempt = 1;
    attempt <= MAX_ATTEMPTS;
    attempt++
  ) {
    try {
      if (await isEpfoErrorPage(page)) {
        await onNetworkRetry();

        await recoverFromErrorPage(page);
      }

      await closeSecurityAlert(page);

      const forgotLink = page
        .locator("a, button")
        .filter({
          hasText: /Forgot Password/i,
        })
        .first();

      await forgotLink.waitFor({
        state: "visible",
        timeout: 30000,
      });

      await forgotLink.click();

      await page.waitForTimeout(2000);

      if (await isEpfoErrorPage(page)) {
        if (attempt === MAX_ATTEMPTS) {
          throw new Error(
            "EPFO_NETWORK_ERROR"
          );
        }

        await onNetworkRetry();

        await recoverFromErrorPage(page);

        continue;
      }

      await page.waitForSelector("#uan", {
        state: "visible",
        timeout: 30000,
      });

      console.log(
        ">>> FORGOT PASSWORD PAGE READY"
      );

      return;
    } catch (error) {
      if (attempt === MAX_ATTEMPTS) {
        throw error;
      }

      await onNetworkRetry();

      console.log(
        `>>> NETWORK RETRY ${attempt}/${MAX_ATTEMPTS}`
      );

      await page
        .goto(EPFO_MEMBER_URL, {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        })
        .catch(() => {});

      await page.waitForTimeout(1500);
    }
  }

  throw new Error("EPFO_NETWORK_ERROR");
}


// ======================================================
// FILL USER DETAILS
// ======================================================

async function fillForgotPasswordDetails(
  page,
  details
) {
  const {
    uan,
    name,
    dob,
    gender,
    mobile,
  } = details;

  await page.locator("#uan").fill(uan);

  await page.locator("#name").fill(name);

  await page.locator("#dob").fill(dob);

  await page
    .locator("#gender")
    .selectOption(gender);

  await page
    .locator("#aadhaarLinkedMobileNo")
    .fill(mobile);

  const consent =
    page.locator("#aadharConsent");

  if (!(await consent.isChecked())) {
    await consent.check();
  }

  console.log(
    ">>> FORGOT PASSWORD DETAILS FILLED"
  );
}


// ======================================================
// CAPTCHA
// ======================================================

async function getForgotPasswordCaptcha(page) {
  const captchaImage =
    page.locator("img.captcha-img");

  await captchaImage.waitFor({
    state: "visible",
    timeout: 30000,
  });

  return await captchaImage.screenshot();
}


// ======================================================
// CREATE SESSION
// ======================================================

async function createForgotPasswordSession(
  details,
  onNetworkRetry = async () => {}
) {
  const browser = await chromium.launch({
    headless: false,
  });

  const context =
    await browser.newContext();

  const page =
    await context.newPage();

  try {
    await page.goto(EPFO_MEMBER_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await openForgotPasswordPage(
      page,
      onNetworkRetry
    );

    await fillForgotPasswordDetails(
      page,
      details
    );

    const captchaBuffer =
      await getForgotPasswordCaptcha(page);

    return {
      browser,
      context,
      page,
      details,
      captchaBuffer,
    };
  } catch (error) {
    await browser.close().catch(() => {});

    throw error;
  }
}


// ======================================================
// REFILL DETAILS AFTER EPFO NETWORK RESTART
// ======================================================

async function restartForgotPasswordForm(
  session,
  onNetworkRetry = async () => {}
) {
  const { page, details } = session;

  await page.goto(EPFO_MEMBER_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  await openForgotPasswordPage(
    page,
    onNetworkRetry
  );

  await fillForgotPasswordDetails(
    page,
    details
  );

  return await getForgotPasswordCaptcha(
    page
  );
}


// ======================================================
// SUBMIT CAPTCHA + REQUEST OTP
// ======================================================

async function submitForgotPasswordCaptcha(
  session,
  captchaText,
  onNetworkRetry = async () => {}
) {
  const { page } = session;

  await page
    .locator("#captcha")
    .fill(captchaText);

  await page
    .locator("#Otpsubmit")
    .click();

  await page.waitForTimeout(2500);

  // ----------------------------------------------
  // EPFO temporary network error
  // ----------------------------------------------

  if (await isEpfoErrorPage(page)) {
    await onNetworkRetry();

    const captchaBuffer =
      await restartForgotPasswordForm(
        session,
        onNetworkRetry
      );

    return {
      success: false,
      reason: "network_retry",
      captchaBuffer,
    };
  }


  // ----------------------------------------------
  // Get visible page text
  // ----------------------------------------------

  const bodyText = await page
    .locator("body")
    .innerText()
    .catch(() => "");

  const lowerText =
    bodyText.toLowerCase();


  // ----------------------------------------------
  // CAPTCHA WRONG
  // ----------------------------------------------

  if (
    lowerText.includes("invalid captcha") ||
    lowerText.includes("incorrect captcha") ||
    lowerText.includes("captcha does not match") ||
    lowerText.includes("wrong captcha")
  ) {
    const captchaBuffer =
      await getForgotPasswordCaptcha(page);

    return {
      success: false,
      reason: "captcha",
      captchaBuffer,
    };
  }


  // ----------------------------------------------
  // Still on same first form?
  // Could be invalid UAN/name/DOB/mobile etc.
  // ----------------------------------------------

  const firstFormVisible =
    await page
      .locator("#uan")
      .isVisible()
      .catch(() => false);

  if (firstFormVisible) {
    const captchaBuffer =
      await getForgotPasswordCaptcha(page)
        .catch(() => null);

    return {
      success: false,
      reason: "details",
      message: bodyText,
      captchaBuffer,
    };
  }


  // ----------------------------------------------
  // We left first form.
  // Most likely OTP page.
  // ----------------------------------------------

  return {
    success: true,
    reason: "otp_sent",
    url: page.url(),
  };
}


// ======================================================
// CLOSE SESSION
// ======================================================
async function submitForgotPasswordReset(
  session,
  otp,
  newPassword,
  confirmPassword
) {
  const { page } = session;

  await page.locator("#otp").fill(otp);

  await page
    .locator("#newPassword")
    .fill(newPassword);

  await page
    .locator("#confirmPassword")
    .fill(confirmPassword);

  await page
    .locator("#Otpsubmit")
    .click();

  await page.waitForTimeout(2500);

  if (await isEpfoErrorPage(page)) {
    return {
      success: false,
      reason: "network",
    };
  }

  const bodyText = await page
    .locator("body")
    .innerText()
    .catch(() => "");

  const lowerText = bodyText.toLowerCase();

  // Invalid OTP
  if (
    lowerText.includes("invalid otp") ||
    lowerText.includes("incorrect otp") ||
    lowerText.includes("wrong otp") ||
    lowerText.includes("otp is not valid")
  ) {
    return {
      success: false,
      reason: "otp",
    };
  }

  // Still on OTP/password form
  const otpStillVisible = await page
    .locator("#otp")
    .isVisible()
    .catch(() => false);

  if (otpStillVisible) {
    return {
      success: false,
      reason: "validation",
      message: bodyText,
    };
  }

  return {
    success: true,
    reason: "password_reset",
    message: bodyText,
  };
}


async function closeForgotPasswordSession(
  session
) {
  if (!session) return;

  try {
    await session.browser.close();
  } catch (error) {}
}


// ======================================================
// EXPORTS
// ======================================================

module.exports = {
  createForgotPasswordSession,
  getForgotPasswordCaptcha,
  submitForgotPasswordCaptcha,
  submitForgotPasswordReset,
  closeForgotPasswordSession,
};