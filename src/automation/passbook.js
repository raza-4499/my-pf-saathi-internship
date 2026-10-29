const { chromium } = require("playwright");

const PASSBOOK_URL =
  "https://passbook.epfindia.gov.in/MemberPassBook/login";


// ==========================================
// CREATE PASSBOOK SESSION
// ==========================================

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

  // Fill UAN and Password
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


// ==========================================
// GET CAPTCHA IMAGE
// ==========================================

async function getCaptcha(page) {
  await page.waitForSelector("#captcha_id", {
    state: "visible",
    timeout: 30000,
  });

  return await page.locator("#captcha_id").screenshot();
}


// ==========================================
// RETRY WITH NEW PASSWORD
// Same UAN + same browser session
// ==========================================

async function retryPassword(session, password) {
  const { page } = session;

  await page.waitForSelector("#password", {
    state: "visible",
    timeout: 30000,
  });

  await page.locator("#password").fill(password);

  // Clear old captcha input
  await page.locator("#captcha").fill("");

  const captchaBuffer = await getCaptcha(page);

  return captchaBuffer;
}


// ==========================================
// SUBMIT CAPTCHA / LOGIN
// ==========================================

async function submitCaptcha(session, captchaText) {
  const { page } = session;

  await page.locator("#captcha").fill(captchaText);

  await page.locator("#login").click();

  // Allow EPFO response to load
  await page.waitForTimeout(3000);

  const loginFormVisible = await page
    .locator("#username")
    .isVisible()
    .catch(() => false);


  // ========================================
  // LOGIN SUCCESS
  // ========================================

  if (!loginFormVisible) {
    return {
      success: true,
      url: page.url(),
    };
  }


  // ========================================
  // LOGIN FAILED
  // ========================================

  const bodyText = await page
    .locator("body")
    .innerText()
    .catch(() => "");

  const lowerText = bodyText.toLowerCase();


  // CAPTCHA ERROR
  if (
    lowerText.includes("invalid captcha") ||
    lowerText.includes("incorrect captcha") ||
    lowerText.includes("captcha does not match") ||
    lowerText.includes("wrong captcha")
  ) {
    return {
      success: false,
      reason: "captcha",
      captchaBuffer: await getCaptcha(page),
    };
  }


  // UAN / PASSWORD ERROR
  if (
    lowerText.includes("invalid password") ||
    lowerText.includes("incorrect password") ||
    lowerText.includes("wrong password") ||
    lowerText.includes("invalid uan") ||
    lowerText.includes("uan or password") ||
    lowerText.includes("credentials")
  ) {
    return {
      success: false,
      reason: "credentials",
    };
  }


  // Unknown login failure
  return {
    success: false,
    reason: "login_failed",
  };
}


// ==========================================
// CLOSE SESSION
// ==========================================

async function openSectionWithRetry(
  page,
  sectionName,
  readySelector
) {
  const MAX_ATTEMPTS = 15;
  const RETRY_DELAY = 3000;

  for (
    let attempt = 1;
    attempt <= MAX_ATTEMPTS;
    attempt++
  ) {
    console.log(
      `>>> Opening ${sectionName} - attempt ${attempt}/${MAX_ATTEMPTS}`
    );

    try {
      const sectionLink = page.locator(
        `.page-url[data-name="${sectionName}"]`
      );

      const linkVisible = await sectionLink
        .isVisible()
        .catch(() => false);

      if (linkVisible) {
        await sectionLink.click().catch(() => {});
      }

      const ready = await page
        .locator(readySelector)
        .isVisible()
        .catch(() => false);

      if (ready) {
        console.log(
          `>>> ${sectionName} READY`
        );

        return true;
      }

      // Click ke baad thoda load hone do
      await page.waitForTimeout(RETRY_DELAY);

      const readyAfterWait = await page
        .locator(readySelector)
        .isVisible()
        .catch(() => false);

      if (readyAfterWait) {
        console.log(
          `>>> ${sectionName} READY`
        );

        return true;
      }
    } catch (error) {
      console.log(
        `>>> ${sectionName} not ready yet`
      );
    }

    if (attempt < MAX_ATTEMPTS) {
      await page.waitForTimeout(RETRY_DELAY);
    }
  }

  throw new Error(
    `${sectionName.toUpperCase()}_LOAD_TIMEOUT`
  );
}

async function getPfAccountDetails(session) {
  const { page } = session;

  // ==========================================
  // STEP 1: SERVICE HISTORY
  // Company Name + Est ID + Member ID
  // ==========================================

await openSectionWithRetry(
  page,
  "service-history",
  ".service-history-timeline"
);

  const serviceText = await page
    .locator(".service-history-timeline")
    .innerText();

  const lines = serviceText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const services = [];

  for (let i = 0; i < lines.length; i++) {
    if (/^Est\.?\s*Id$/i.test(lines[i])) {
      const companyName =
        lines[i - 1] || "Unknown Establishment";

      const establishmentId =
        lines[i + 1] || "";

      let memberId = "";

      for (
        let j = i + 2;
        j < Math.min(i + 8, lines.length);
        j++
      ) {
        if (/^Member\s*Id$/i.test(lines[j])) {
          memberId = lines[j + 1] || "";
          break;
        }
      }

      if (memberId) {
        services.push({
          companyName,
          establishmentId,
          memberId,
        });
      }
    }
  }


  // ==========================================
  // STEP 2: OPEN PASSBOOK
  // ==========================================

await openSectionWithRetry(
  page,
  "passbook",
  "#selectmid"
);


  // ==========================================
  // GET ALL MEMBER IDS
  // ==========================================

  const memberOptions = await page
    .locator("#selectmid option")
    .evaluateAll((options) =>
      options
        .map((option) => ({
          value: option.value,
          text: (
            option.textContent || ""
          ).trim(),
        }))
        .filter(
          (option) =>
            option.value &&
            option.text
        )
    );


  const balanceResults = [];


  // ==========================================
  // LOOP THROUGH EVERY MEMBER ID
  // ==========================================

  for (const member of memberOptions) {
    await page
      .locator("#selectmid")
      .selectOption(member.value);

    await page.waitForTimeout(1500);


    // ========================================
    // GET AVAILABLE FINANCIAL YEARS
    // ========================================

    await page.waitForSelector("#selectfy", {
      state: "visible",
      timeout: 30000,
    });

    const fyOptions = await page
      .locator("#selectfy option")
      .evaluateAll((options) =>
        options
          .map((option) => ({
            value: option.value,
            text: (
              option.textContent || ""
            ).trim(),
          }))
          .filter(
            (option) =>
              option.value &&
              option.text
          )
      );


    if (fyOptions.length === 0) {
      balanceResults.push({
        memberId: member.text,
        available: false,
      });

      continue;
    }


    // First option = latest financial year
    const latestFY = fyOptions[0];

    await page
      .locator("#selectfy")
      .selectOption(latestFY.value);

    await page.waitForTimeout(1500);


    // ========================================
    // WAIT FOR PASSBOOK TABLE
    // ========================================

    await page.waitForSelector("#table-pb", {
      state: "visible",
      timeout: 30000,
    });


    // ========================================
    // READ TABLE ROWS
    // ========================================

    const rows = await page
      .locator("#table-pb tr")
      .evaluateAll((elements) =>
        elements.map((row) =>
          Array.from(
            row.querySelectorAll("td")
          ).map((cell) =>
            (
              cell.innerText ||
              cell.textContent ||
              ""
            ).trim()
          )
        )
      );


    // ========================================
    // FIND CLOSING BALANCE ROW
    // ========================================

const closingRow = rows.find((row) =>
  row.some((cell) =>
    /Closing Balance/i.test(cell)
  )
);


// ========================================
// FIND LAST CONTRIBUTION MONTH
// ========================================

const contributionRows = rows.filter((row) => {
  const rowText = row.join(" ");

  return (
    row.includes("+") &&
    /Cont\.?\s*for\s*Due-Month/i.test(rowText)
  );
});

let lastContributionMonth = "";

if (contributionRows.length > 0) {
  const lastContributionRow =
    contributionRows[
      contributionRows.length - 1
    ];

  // First column = Wage Month
  lastContributionMonth =
    lastContributionRow[0] || "";
}


// ========================================
// IF CLOSING BALANCE NOT FOUND
// ========================================

if (!closingRow) {
  balanceResults.push({
    memberId: member.text,
    financialYear: latestFY.text,
    lastContributionMonth,
    available: false,
  });

  continue;
}


    // ========================================
    // EXTRACT AMOUNTS
    // ========================================

    const amountValues = closingRow
      .map((value) => {
        const cleaned = String(value)
          .replace(/₹/g, "")
          .replace(/,/g, "")
          .trim();

        if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) {
          return null;
        }

        return Number(cleaned);
      })
      .filter((value) => value !== null);


    // Last 3 numeric columns:
    // Employee Share
    // Employer Share
    // Pension Share

    const employeeShare =
      amountValues.length >= 3
        ? amountValues[
            amountValues.length - 3
          ]
        : 0;

    const employerShare =
      amountValues.length >= 2
        ? amountValues[
            amountValues.length - 2
          ]
        : 0;

    const pensionShare =
      amountValues.length >= 1
        ? amountValues[
            amountValues.length - 1
          ]
        : 0;


    // EPF balance = employee + employer
    const pfBalance =
      employeeShare + employerShare;


    const closingLabel =
      closingRow.find((cell) =>
        /Closing Balance/i.test(cell)
      ) || "";


    balanceResults.push({
      memberId: member.text,
      financialYear: latestFY.text,
      closingLabel,

      lastContributionMonth,

      employeeShare,
      employerShare,
      pensionShare,
      pfBalance,

      available: true,
    });
  }


  // ==========================================
  // STEP 3: MERGE SERVICE + BALANCE DATA
  // ==========================================

  function normalizeMemberId(value) {
    return String(value || "")
      .replace(/\s+/g, "")
      .toUpperCase();
  }


  const finalAccounts = services.map(
    (service) => {

      const balance = balanceResults.find(
        (item) =>
          normalizeMemberId(item.memberId) ===
          normalizeMemberId(
            service.memberId
          )
      );

      return {
        ...service,

        lastContributionMonth:
          balance?.lastContributionMonth || "",

        financialYear:
          balance?.financialYear || "",

        closingLabel:
          balance?.closingLabel || "",

        employeeShare:
          balance?.employeeShare ?? null,

        employerShare:
          balance?.employerShare ?? null,

        pfBalance:
          balance?.pfBalance ?? null,

        pensionShare:
          balance?.pensionShare ?? null,

        balanceAvailable:
          balance?.available === true,
      };
    }
  );


  // Passbook Member ID exists but Service History
  // mapping somehow missing
  for (const balance of balanceResults) {
    const exists = finalAccounts.some(
      (account) =>
        normalizeMemberId(account.memberId) ===
        normalizeMemberId(balance.memberId)
    );

    if (!exists) {
      finalAccounts.push({
        companyName:
          "Establishment name unavailable",

        lastContributionMonth:
        balance.lastContributionMonth || "",

        establishmentId: "",

        memberId: balance.memberId,

        financialYear:
          balance.financialYear || "",

        closingLabel:
          balance.closingLabel || "",

        employeeShare:
          balance.employeeShare ?? null,

        employerShare:
          balance.employerShare ?? null,

        pfBalance:
          balance.pfBalance ?? null,

        pensionShare:
          balance.pensionShare ?? null,

        balanceAvailable:
          balance.available === true,
      });
    }
  }


  return finalAccounts;
}

async function closePassbookSession(session) {
  if (!session) return;

  try {
    await session.browser.close();
  } catch (error) {
    // Ignore cleanup errors
  }
}


// ==========================================
// EXPORTS
// ==========================================

module.exports = {
  createPassbookSession,
  retryPassword,
  submitCaptcha,
  getPfAccountDetails,
  closePassbookSession,
};