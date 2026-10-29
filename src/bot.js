require("dotenv").config();

const { Telegraf, Markup } = require("telegraf");

const {
  createPassbookSession,
  retryPassword,
  submitCaptcha,
  getPfAccountDetails,
  closePassbookSession,
} = require("./automation/passbook");

const {
  createForgotPasswordSession,
  submitForgotPasswordCaptcha,
  submitForgotPasswordReset,
  closeForgotPasswordSession,
} = require("./automation/forgotPassword");

const {
  registerUser,
  recordUsage,
  getUserStats,
  getUsageStats,
} = require("./analytics/analytics");

// console.log(
//   "DEBUG createForgotPasswordSession:",
//   typeof createForgotPasswordSession
// );

if (!process.env.BOT_TOKEN) {
  console.error("BOT_TOKEN not found in .env");
  process.exit(1);
}

const bot = new Telegraf(process.env.BOT_TOKEN);

// Temporary in-memory user sessions
// Nothing is permanently saved.
const userSessions = new Map();

const MAX_CONCURRENT_JOBS = Math.max(
  1,
  parseInt(
    process.env.MAX_CONCURRENT_JOBS || "2",
    10
  )
);

const activeUserJobs = new Set();
const jobQueue = [];

let runningJobs = 0;

function processJobQueue() {
  while (
    runningJobs < MAX_CONCURRENT_JOBS &&
    jobQueue.length > 0
  ) {
    const { userId, job } = jobQueue.shift();

    runningJobs++;

    Promise.resolve()
      .then(job)
      .catch((error) => {
        console.error(
          `Job failed for user ${userId}:`,
          error
        );
      })
      .finally(() => {
        activeUserJobs.delete(userId);
        runningJobs--;

        processJobQueue();
      });
  }
}

function queueUserJob(ctx, job) {
  const userId = ctx.from?.id;

  if (!userId) return;

  if (activeUserJobs.has(userId)) {
    ctx.reply(
      "⏳ Your previous request is still processing. Please wait."
    ).catch(() => {});

    return;
  }

  activeUserJobs.add(userId);

  jobQueue.push({
    userId,
    job,
  });

  processJobQueue();
}


// =============================
// HELPERS
// =============================

async function safelyDeleteMessage(ctx) {
  try {
    await ctx.deleteMessage();
  } catch (error) {
    // Ignore if Telegram does not allow deletion
  }
}

async function cleanupUserSession(userId) {
  const data = userSessions.get(userId);

  if (data?.passbookSession) {
    await closePassbookSession(data.passbookSession);
  }

  if (data?.forgotPasswordSession) {
  await closeForgotPasswordSession(
    data.forgotPasswordSession
  );
}

  if (data?.timeout) {
    clearTimeout(data.timeout);
  }

  userSessions.delete(userId);
}

function setSessionTimeout(userId) {
  const data = userSessions.get(userId);

  if (!data) return;

  if (data.timeout) {
    clearTimeout(data.timeout);
  }

  data.timeout = setTimeout(async () => {
    await cleanupUserSession(userId);
  }, 5 * 60 * 1000); // 5 minutes
}


// =============================
// MENUS
// =============================

function englishMenu(ctx) {
  return ctx.reply(
    "Welcome to PF SAATHI\n\nWhat would you like to do?",
    Markup.inlineKeyboard([
      [Markup.button.callback("Check Balance", "balance_en")],
     // [Markup.button.callback("Withdraw Advance", "advance_en")],
      [Markup.button.callback("Forgot Password", "forgot_en")],
    ])
  );
}

function hindiMenu(ctx) {
  return ctx.reply(
    "PF SAATHI में आपका स्वागत है।\n\nआप  क्या करना चाहते हैं?",
    Markup.inlineKeyboard([
      [Markup.button.callback("PF Balance Check करें", "balance_hi")],
      // [Markup.button.callback("PF Advance निकालें", "advance_hi")],
      [Markup.button.callback("Password भूल गए", "forgot_hi")],
    ])
  );
}

function showTaskEndOptions(ctx, language) {
  return ctx.reply(
    language === "hi"
      ? "आप क्या करना चाहते हैं?"
      : "What would you like to do next?",
    Markup.inlineKeyboard([
      [
        Markup.button.callback(
          "🔄 Start New",
          "start_new"
        ),
        Markup.button.callback(
          "❌ Close",
          "close_session"
        ),
      ],
    ])
  );
}






// =============================
// START
// =============================

bot.start(async (ctx) => {
  await cleanupUserSession(ctx.from.id);

  try {
    await registerUser(ctx.from.id);
  } catch (error) {
    console.error(
      "User registration failed:",
      error.message
    );
  }

  await ctx.reply(
    "Welcome to PF SAATHI\n\nअपनी भाषा चुनें / Select your language",
    Markup.inlineKeyboard([
      [
        Markup.button.callback("English", "language_en"),
        Markup.button.callback("हिंदी", "language_hi"),
      ],
    ])
  );
});


bot.command("stats", async (ctx) => {
  const adminId = process.env.ADMIN_TELEGRAM_ID;

  if (String(ctx.from.id) !== String(adminId)) {
    return;
  }

  await ctx.reply(
    "📊 PF SAATHI STATS",
    Markup.inlineKeyboard([
      [
        Markup.button.callback(
          "👥 User",
          "stats_users"
        ),
      ],
      [
        Markup.button.callback(
          "📈 Usage",
          "stats_usage"
        ),
      ],
    ])
  );
});

bot.action("stats_usage", async (ctx) => {
  await ctx.answerCbQuery();

  if (
    String(ctx.from.id) !==
    String(process.env.ADMIN_TELEGRAM_ID)
  ) {
    return;
  }

  await ctx.reply(
    "📈 USAGE STATS\n\nSelect period:",
    Markup.inlineKeyboard([
      [
        Markup.button.callback(
          "Today",
          "usage_stats_today"
        ),
        Markup.button.callback(
          "Weekly",
          "usage_stats_weekly"
        ),
      ],
      [
        Markup.button.callback(
          "Monthly",
          "usage_stats_monthly"
        ),
        Markup.button.callback(
          "Yearly",
          "usage_stats_yearly"
        ),
      ],
    ])
  );
});

bot.action("usage_stats_today", async (ctx) => {
  await ctx.answerCbQuery();

  if (
    String(ctx.from.id) !==
    String(process.env.ADMIN_TELEGRAM_ID)
  ) {
    return;
  }

  try {
    const stats = await getUsageStats("today");

    await ctx.reply(
      `📈 USAGE STATS — Today

Check Balance: ${stats.checkBalance}
Forgot Password: ${stats.forgotPassword}`
    );
  } catch (error) {
    console.error(
      "Usage stats failed:",
      error.message
    );

    await ctx.reply(
      "❌ Unable to load usage stats."
    );
  }
});

bot.action("usage_stats_weekly", async (ctx) => {
  await ctx.answerCbQuery();

  if (
    String(ctx.from.id) !==
    String(process.env.ADMIN_TELEGRAM_ID)
  ) {
    return;
  }

  const stats = await getUsageStats("weekly");

  await ctx.reply(
    `📈 USAGE STATS — Weekly

Check Balance: ${stats.checkBalance}
Forgot Password: ${stats.forgotPassword}`
  );
});

bot.action("usage_stats_monthly", async (ctx) => {
  await ctx.answerCbQuery();

  if (
    String(ctx.from.id) !==
    String(process.env.ADMIN_TELEGRAM_ID)
  ) {
    return;
  }

  const stats = await getUsageStats("monthly");

  await ctx.reply(
    `📈 USAGE STATS — Monthly

Check Balance: ${stats.checkBalance}
Forgot Password: ${stats.forgotPassword}`
  );
});

bot.action("usage_stats_yearly", async (ctx) => {
  await ctx.answerCbQuery();

  if (
    String(ctx.from.id) !==
    String(process.env.ADMIN_TELEGRAM_ID)
  ) {
    return;
  }

  const stats = await getUsageStats("yearly");

  await ctx.reply(
    `📈 USAGE STATS — Yearly

Check Balance: ${stats.checkBalance}
Forgot Password: ${stats.forgotPassword}`
  );
});


bot.action("stats_users", async (ctx) => {
  await ctx.answerCbQuery();

  if (
    String(ctx.from.id) !==
    String(process.env.ADMIN_TELEGRAM_ID)
  ) {
    return;
  }

  await ctx.reply(
    "👥 USER STATS\n\nSelect period:",
    Markup.inlineKeyboard([
      [
        Markup.button.callback(
          "Today",
          "user_stats_today"
        ),
        Markup.button.callback(
          "Weekly",
          "user_stats_weekly"
        ),
      ],
      [
        Markup.button.callback(
          "Monthly",
          "user_stats_monthly"
        ),
        Markup.button.callback(
          "Yearly",
          "user_stats_yearly"
        ),
      ],
    ])
  );
});


bot.action("user_stats_today", async (ctx) => {
  await ctx.answerCbQuery();

  if (
    String(ctx.from.id) !==
    String(process.env.ADMIN_TELEGRAM_ID)
  ) {
    return;
  }

  try {
    const stats = await getUserStats("today");

    await ctx.reply(
      `👥 USER STATS — Today

New User: ${stats.newUsers}
Existing User: ${stats.existingUsers}
Active User: ${stats.activeUsers}
All User: ${stats.allUsers}`
    );
  } catch (error) {
    console.error(
      "User stats failed:",
      error.message
    );

    await ctx.reply(
      "❌ Unable to load user stats."
    );
  }
});

bot.action("user_stats_weekly", async (ctx) => {
  await ctx.answerCbQuery();

  if (
    String(ctx.from.id) !==
    String(process.env.ADMIN_TELEGRAM_ID)
  ) {
    return;
  }

  const stats = await getUserStats("weekly");

  await ctx.reply(
    `👥 USER STATS — Weekly

New User: ${stats.newUsers}
Existing User: ${stats.existingUsers}
Active User: ${stats.activeUsers}
All User: ${stats.allUsers}`
  );
});

bot.action("user_stats_monthly", async (ctx) => {
  await ctx.answerCbQuery();

  if (
    String(ctx.from.id) !==
    String(process.env.ADMIN_TELEGRAM_ID)
  ) {
    return;
  }

  const stats = await getUserStats("monthly");

  await ctx.reply(
    `👥 USER STATS — Monthly

New User: ${stats.newUsers}
Existing User: ${stats.existingUsers}
Active User: ${stats.activeUsers}
All User: ${stats.allUsers}`
  );
});

bot.action("user_stats_yearly", async (ctx) => {
  await ctx.answerCbQuery();

  if (
    String(ctx.from.id) !==
    String(process.env.ADMIN_TELEGRAM_ID)
  ) {
    return;
  }

  const stats = await getUserStats("yearly");

  await ctx.reply(
    `👥 USER STATS — Yearly

New User: ${stats.newUsers}
Existing User: ${stats.existingUsers}
Active User: ${stats.activeUsers}
All User: ${stats.allUsers}`
  );
});

// =============================
// LANGUAGE
// =============================

bot.action("language_en", async (ctx) => {
  await ctx.answerCbQuery();

  try {
    await registerUser(ctx.from.id, "en");
  } catch (error) {
    console.error(
      "User language update failed:",
      error.message
    );
  }

  await englishMenu(ctx);
});

bot.action("language_hi", async (ctx) => {
  await ctx.answerCbQuery();

  try {
    await registerUser(ctx.from.id, "hi");
  } catch (error) {
    console.error(
      "User language update failed:",
      error.message
    );
  }

  await hindiMenu(ctx);
});

bot.action(
  /^forgot_gender_(M|F|T)$/,
  async (ctx) => {
    await ctx.answerCbQuery();

    const userId = ctx.from.id;
    const data = userSessions.get(userId);

    if (
      !data ||
      data.step !== "forgot_gender"
    ) {
      return;
    }

    const gender = ctx.match[1];

    data.gender = gender;
    data.step = "forgot_mobile";

    setSessionTimeout(userId);

    if (data.language === "hi") {
      await ctx.reply(
        "कृपया आधार से लिंक 10 अंकों का मोबाइल नंबर दर्ज करें।"
      );
    } else {
      await ctx.reply(
        "Please enter your 10-digit Aadhaar-linked mobile number."
      );
    }
  }
);


// =============================
// CHECK BALANCE
// =============================

async function startBalanceFlow(ctx, language) {
  await ctx.answerCbQuery();

  const userId = ctx.from.id;

  await cleanupUserSession(userId);

userSessions.set(userId, {
  language,
  step: "awaiting_uan",
  credentialAttempts: 0,
});

  setSessionTimeout(userId);

  if (language === "hi") {
    await ctx.reply(
      "अपना UAN Number भेजें।\n\nयह जानकारी permanently save नहीं की जाएगी।"
    );
  } else {
    await ctx.reply(
      "Please send your UAN Number.\n\nThis information will not be permanently saved."
    );
  }
}

bot.action("balance_en", (ctx) => startBalanceFlow(ctx, "en"));
bot.action("balance_hi", (ctx) => startBalanceFlow(ctx, "hi"));


// =============================
// OTHER FEATURES - LATER
// =============================

// bot.action("advance_en", async (ctx) => {
//   await ctx.answerCbQuery();
//   await ctx.reply("Withdraw Advance will be connected after Balance Check.");
// });

// bot.action("advance_hi", async (ctx) => {
//   await ctx.answerCbQuery();
//   await ctx.reply("PF Advance को Balance Check के बाद connect करेंगे।");
// });

bot.action("forgot_en", async (ctx) => {
  await ctx.answerCbQuery();

  const userId = ctx.from.id;

  await cleanupUserSession(userId);

  userSessions.set(userId, {
    language: "en",
    step: "forgot_uan",
  });

  await ctx.reply(
    "Please enter your 12-digit UAN."
  );
});


bot.action("forgot_hi", async (ctx) => {
  await ctx.answerCbQuery();

  const userId = ctx.from.id;

  await cleanupUserSession(userId);

  userSessions.set(userId, {
    language: "hi",
    step: "forgot_uan",
  });

  await ctx.reply(
    "कृपया अपना 12 अंकों का UAN दर्ज करें।"
  );
});


// =============================
// TEXT INPUT HANDLER
// =============================

//bot.on("text", async (ctx) => {
  bot.on("text", (ctx) => {
  queueUserJob(ctx, async () => {
  const userId = ctx.from.id;
  const data = userSessions.get(userId);

if (data?.step === "forgot_mobile") {
  const mobile = ctx.message.text.trim();

  if (!/^[6-9]\d{9}$/.test(mobile)) {
    await ctx.reply(
      data.language === "hi"
        ? "❌ कृपया सही 10 अंकों का मोबाइल नंबर दर्ज करें।"
        : "❌ Please enter a valid 10-digit mobile number."
    );

    return;
  }

  data.mobile = mobile;
  data.step = "forgot_loading";

  setSessionTimeout(userId);

  await ctx.reply(
    data.language === "hi"
      ? "⏳ EPFO से जुड़ रहा है..."
      : "⏳ Connecting to EPFO..."
  );

  try {
    const forgotPasswordSession =
      await createForgotPasswordSession(
        {
          uan: data.uan,
          name: data.name,
          dob: data.dob,
          gender: data.gender,
          mobile: data.mobile,
        },
        async () => {
          await ctx.reply(
            data.language === "hi"
              ? "⚠️ नेटवर्क त्रुटि\nदोबारा प्रयास किया जा रहा है..."
              : "⚠️ Network Error\nTrying again..."
          );
        }
      );

    data.forgotPasswordSession =
      forgotPasswordSession;

    data.step = "forgot_captcha";

    setSessionTimeout(userId);

    await ctx.replyWithPhoto(
      {
        source:
          forgotPasswordSession.captchaBuffer,
      },
      {
        caption:
          data.language === "hi"
            ? "🔐 ऊपर दिखाया गया CAPTCHA दर्ज करें।"
            : "🔐 Please enter the CAPTCHA shown above.",
      }
    );
  } catch (error) {
    console.error(
      "Forgot Password error:",
      error.message
    );

    await ctx.reply(
      data.language === "hi"
        ? "❌ अभी EPFO से कनेक्ट नहीं हो पा रहा है। कृपया बाद में दोबारा प्रयास करें।"
        : "❌ Unable to connect to EPFO right now. Please try again later."
    );

    await cleanupUserSession(userId);
  }

  return;
}

if (data?.step === "forgot_captcha") {
  const captchaText = ctx.message.text.trim();

  // CAPTCHA message Telegram se delete
  await safelyDeleteMessage(ctx);

  if (!data.forgotPasswordSession) {
    await ctx.reply(
      data.language === "hi"
        ? "❌ सेशन समाप्त हो गया है। कृपया Forgot Password दोबारा शुरू करें।"
        : "❌ Session expired. Please start Forgot Password again."
    );

    await cleanupUserSession(userId);
    return;
  }

  data.step = "forgot_captcha_submitting";

  setSessionTimeout(userId);

  try {
    const result =
      await submitForgotPasswordCaptcha(
        data.forgotPasswordSession,
        captchaText,
        async () => {
          await ctx.reply(
            data.language === "hi"
              ? "⚠️ नेटवर्क त्रुटि\nदोबारा प्रयास किया जा रहा है..."
              : "⚠️ Network Error\nTrying again..."
          );
        }
      );

    // CAPTCHA galat
    if (
      !result.success &&
      result.reason === "captcha"
    ) {
      data.step = "forgot_captcha";

      setSessionTimeout(userId);

      await ctx.reply(
        data.language === "hi"
          ? "❌ CAPTCHA गलत है। नया CAPTCHA दर्ज करें।"
          : "❌ Invalid CAPTCHA. Please enter the new CAPTCHA."
      );

      if (result.captchaBuffer) {
        await ctx.replyWithPhoto(
          {
            source: result.captchaBuffer,
          },
          {
            caption:
              data.language === "hi"
                ? "🔐 नया CAPTCHA दर्ज करें।"
                : "🔐 Please enter the new CAPTCHA.",
          }
        );
      }

      return;
    }

    // EPFO network error ke baad form restart hua
    if (
      !result.success &&
      result.reason === "network_retry"
    ) {
      data.step = "forgot_captcha";

      setSessionTimeout(userId);

      if (result.captchaBuffer) {
        await ctx.replyWithPhoto(
          {
            source: result.captchaBuffer,
          },
          {
            caption:
              data.language === "hi"
                ? "🔐 कृपया नया CAPTCHA दर्ज करें।"
                : "🔐 Please enter the new CAPTCHA.",
          }
        );
      }

      return;
    }

    // EPFO ne details accept nahi ki
    if (
      !result.success &&
      result.reason === "details"
    ) {
      await ctx.reply(
        data.language === "hi"
          ? "❌ EPFO ने दी गई जानकारी स्वीकार नहीं की। कृपया UAN, नाम, जन्म तिथि, लिंग और मोबाइल नंबर जांचें।"
          : "❌ EPFO did not accept the provided details. Please verify your UAN, name, date of birth, gender and mobile number."
      );

      await cleanupUserSession(userId);
      return;
    }

    // OTP page reached
    if (
      result.success &&
      result.reason === "otp_sent"
    ) {
      data.step = "forgot_otp";

      setSessionTimeout(userId);

      await ctx.reply(
        data.language === "hi"
          ? "✅ OTP भेज दिया गया है।\nकृपया 6 अंकों का OTP दर्ज करें।"
          : "✅ OTP has been sent.\nPlease enter the 6-digit OTP."
      );

      return;
    }

    data.step = "forgot_captcha";

    await ctx.reply(
      data.language === "hi"
        ? "❌ CAPTCHA submit नहीं हो पाया। कृपया दोबारा प्रयास करें।"
        : "❌ CAPTCHA could not be submitted. Please try again."
    );
  } catch (error) {
    console.error(
      "Forgot CAPTCHA error:",
      error.message
    );

    await ctx.reply(
      data.language === "hi"
        ? "❌ EPFO अनुरोध पूरा नहीं हो पाया। कृपया दोबारा प्रयास करें।"
        : "❌ Unable to complete the EPFO request. Please try again."
    );

    await cleanupUserSession(userId);
  }

  return;
}

// ======================================================
// FORGOT PASSWORD - OTP
// ======================================================

if (data?.step === "forgot_otp") {
  const otp = ctx.message.text.trim();

  // OTP message delete
  await safelyDeleteMessage(ctx);

  if (!/^\d{6}$/.test(otp)) {
    await ctx.reply(
      data.language === "hi"
        ? "❌ कृपया सही 6 अंकों का OTP दर्ज करें।"
        : "❌ Please enter a valid 6-digit OTP."
    );

    return;
  }

  data.otp = otp;
  data.step = "forgot_new_password";

  setSessionTimeout(userId);

  await ctx.reply(
    data.language === "hi"
      ? "🔐 नया Password सेट करें\n\nकृपया अपना नया EPFO Password दर्ज करें।\n\nPassword में कम से कम:\n• 1 Capital Letter\n• 1 Small Letter\n• 1 Number\n• 1 Special Character (@ # $ % आदि)\n\nउदाहरण: India@123"
      : "🔐 Set a New Password\n\nPlease enter your new EPFO password.\n\nPassword should contain at least:\n• 1 Capital Letter\n• 1 Small Letter\n• 1 Number\n• 1 Special Character (@ # $ % etc.)\n\nExample: India@123"
  );

  return;
}

// ======================================================
// FORGOT PASSWORD - NEW PASSWORD
// ======================================================

if (data?.step === "forgot_new_password") {
  const newPassword = ctx.message.text.trim();

  // Password message Telegram se delete
  await safelyDeleteMessage(ctx);

  const hasUpper = /[A-Z]/.test(newPassword);
  const hasLower = /[a-z]/.test(newPassword);
  const hasNumber = /\d/.test(newPassword);
  const hasSpecial = /[^A-Za-z0-9]/.test(newPassword);

  if (
    !hasUpper ||
    !hasLower ||
    !hasNumber ||
    !hasSpecial
  ) {
    await ctx.reply(
      data.language === "hi"
        ? "❌ Password सही format में नहीं है.\n\nकृपया ऐसा password डालें जिसमें:\n• 1 Capital Letter\n• 1 Small Letter\n• 1 Number\n• 1 Special Character\n\nउदाहरण: India@123"
        : "❌ Password does not meet the required format.\n\nPlease use at least:\n• 1 Capital Letter\n• 1 Small Letter\n• 1 Number\n• 1 Special Character\n\nExample: India@123"
    );

    return;
  }

  data.newPassword = newPassword;
  data.step = "forgot_confirm_password";

  setSessionTimeout(userId);

  await ctx.reply(
    data.language === "hi"
      ? "🔐 Confirm New Password\n\nकृपया वही नया Password दोबारा दर्ज करें।"
      : "🔐 Confirm New Password\n\nPlease enter the same new password again."
  );

  return;
}

// ======================================================
// FORGOT PASSWORD - CONFIRM PASSWORD
// ======================================================

if (data?.step === "forgot_confirm_password") {
  const confirmPassword = ctx.message.text.trim();

  // Confirm password message Telegram se delete
  await safelyDeleteMessage(ctx);

  // Dono password match nahi hue
  if (confirmPassword !== data.newPassword) {
    await ctx.reply(
      data.language === "hi"
        ? "❌ Password match नहीं हो रहे हैं।\n\nकृपया वही नया Password दोबारा दर्ज करें।"
        : "❌ Passwords do not match.\n\nPlease enter the same new password again."
    );

    return;
  }

  if (!data.forgotPasswordSession) {
    await ctx.reply(
      data.language === "hi"
        ? "❌ Session समाप्त हो गया है। कृपया Forgot Password दोबारा शुरू करें।"
        : "❌ Session expired. Please start Forgot Password again."
    );

    await cleanupUserSession(userId);
    return;
  }

  data.step = "forgot_reset_submitting";

  setSessionTimeout(userId);

  await ctx.reply(
    data.language === "hi"
      ? "⏳ OTP verify करके Password update किया जा रहा है..."
      : "⏳ Verifying OTP and updating your password..."
  );

  try {
    const result =
      await submitForgotPasswordReset(
        data.forgotPasswordSession,
        data.otp,
        data.newPassword,
        confirmPassword
      );

    // =========================
    // SUCCESS
    // =========================

if (result.success) {
  const language = data.language;

  await ctx.reply(
    language === "hi"
      ? "✅ आपका EPFO Password सफलतापूर्वक बदल दिया गया है।"
      : "✅ Your EPFO password has been changed successfully."
  );

  try {
    await recordUsage(
      userId,
      "forgot_password",
      "success"
    );
  } catch (error) {
    console.error(
      "Usage tracking failed:",
      error.message
    );
  }

  await cleanupUserSession(userId);

  await showTaskEndOptions(
    ctx,
    language
  );

  return;
}

    // =========================
    // INVALID OTP
    // =========================

    if (result.reason === "otp") {
      data.otp = null;
      data.newPassword = null;
      data.step = "forgot_invalid_otp";

      setSessionTimeout(userId);

      await ctx.reply(
        data.language === "hi"
          ? "❌ Invalid OTP.\n\nआप क्या करना चाहते हैं?"
          : "❌ Invalid OTP.\n\nWhat would you like to do?",
        Markup.inlineKeyboard([
          [
            Markup.button.callback(
              data.language === "hi"
                ? "🔁 दोबारा प्रयास करें"
                : "🔁 Retry",
              "forgot_retry_otp"
            ),
            Markup.button.callback(
              data.language === "hi"
                ? "❌ रद्द करें"
                : "❌ Cancel",
              "forgot_cancel"
            ),
          ],
        ])
      );

      return;
    }

    // =========================
    // PASSWORD REJECTED BY EPFO
    // =========================

    if (
      result.reason === "validation"
    ) {
      data.newPassword = null;
      data.step = "forgot_new_password";

      setSessionTimeout(userId);

      await ctx.reply(
        data.language === "hi"
          ? "❌ EPFO ने यह Password स्वीकार नहीं किया।\n\nकृपया दूसरा Password दर्ज करें जिसमें Capital Letter, Small Letter, Number और Special Character हो।\n\nउदाहरण: India@123"
          : "❌ EPFO did not accept this password.\n\nPlease enter another password containing a Capital Letter, Small Letter, Number and Special Character.\n\nExample: India@123"
      );

      return;
    }

    // =========================
    // NETWORK ERROR
    // =========================

    if (result.reason === "network") {
      await ctx.reply(
        data.language === "hi"
          ? "⚠️ Network Error.\nकृपया Forgot Password process दोबारा शुरू करें।"
          : "⚠️ Network Error.\nPlease start the Forgot Password process again."
      );

      await cleanupUserSession(userId);
      return;
    }

    await ctx.reply(
      data.language === "hi"
        ? "❌ Password reset नहीं हो पाया। कृपया दोबारा प्रयास करें।"
        : "❌ Password reset could not be completed. Please try again."
    );

    await cleanupUserSession(userId);

  } catch (error) {
    console.error(
      "Password reset error:",
      error.message
    );

    await ctx.reply(
      data.language === "hi"
        ? "❌ Password reset करते समय समस्या आई। कृपया दोबारा प्रयास करें।"
        : "❌ Something went wrong while resetting the password. Please try again."
    );

    await cleanupUserSession(userId);
  }

  return;
}

// ======================================================
// FORGOT PASSWORD - RETRY OTP
// ======================================================

bot.action("forgot_retry_otp", async (ctx) => {
  await ctx.answerCbQuery();

  const userId = ctx.from.id;
  const data = userSessions.get(userId);

  if (!data) {
    return;
  }

  delete data.otp;
  delete data.newPassword;

  data.step = "forgot_otp";

  setSessionTimeout(userId);

  await ctx.reply(
    data.language === "hi"
      ? "🔁 कृपया 6 अंकों का OTP दोबारा दर्ज करें।"
      : "🔁 Please enter the 6-digit OTP again."
  );
});


// ======================================================
// FORGOT PASSWORD - CANCEL
// ======================================================

bot.action("forgot_cancel", async (ctx) => {
  await ctx.answerCbQuery();

  const userId = ctx.from.id;
  const data = userSessions.get(userId);

  const language = data?.language || "en";

  await cleanupUserSession(userId);

  await ctx.reply(
    language === "hi"
      ? "❌ Forgot Password process रद्द कर दिया गया है।"
      : "❌ Forgot Password process cancelled."
  );
});


bot.action("start_new", async (ctx) => {
  await ctx.answerCbQuery();

  const userId = ctx.from.id;

  await cleanupUserSession(userId);

  try {
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [],
    });
  } catch (error) {}

  await ctx.reply(
    "Welcome to PF SAATHI\n\nअपनी भाषा चुनें / Select your language",
    Markup.inlineKeyboard([
      [
        Markup.button.callback(
          "English",
          "language_en"
        ),
        Markup.button.callback(
          "हिंदी",
          "language_hi"
        ),
      ],
    ])
  );
});

bot.action("close_session", async (ctx) => {
  await ctx.answerCbQuery();

  const userId = ctx.from.id;

  // Current browser/session/data clean
  await cleanupUserSession(userId);

  // Purane Start New / Close buttons hata do
  try {
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [],
    });
  } catch (error) {}

  // Fresh Start New button hamesha available rahega
  await ctx.reply(
    "✅ Session closed.\n\nYou can start a new task anytime.",
    Markup.inlineKeyboard([
      [
        Markup.button.callback(
          "🔄 Start New",
          "start_new"
        ),
      ],
    ])
  );
});


  if (data?.step === "forgot_dob") {
  const dob = ctx.message.text.trim();

  if (!/^\d{2}-\d{2}-\d{4}$/.test(dob)) {
    await ctx.reply(
      data.language === "hi"
        ? "❌ जन्म तिथि DD-MM-YYYY फॉर्मेट में दर्ज करें।"
        : "❌ Please enter DOB in DD-MM-YYYY format."
    );

    return;
  }

  data.dob = dob;
  data.step = "forgot_gender";

  setSessionTimeout(userId);

  await ctx.reply(
    data.language === "hi"
      ? "अपना लिंग चुनें:"
      : "Select your gender:",
    Markup.inlineKeyboard([
      [
        Markup.button.callback(
          data.language === "hi" ? "पुरुष" : "Male",
          "forgot_gender_M"
        ),
        Markup.button.callback(
          data.language === "hi" ? "महिला" : "Female",
          "forgot_gender_F"
        ),
      ],
      [
        Markup.button.callback(
          data.language === "hi" ? "ट्रांसजेंडर" : "Transgender",
          "forgot_gender_T"
        ),
      ],
    ])
  );

  return;
}

  if (data?.step === "forgot_name") {
  const name = ctx.message.text.trim();

  if (name.length < 2) {
    await ctx.reply(
      data.language === "hi"
        ? "❌ कृपया सही नाम दर्ज करें।"
        : "❌ Please enter a valid name."
    );

    return;
  }

  data.name = name;
  data.step = "forgot_dob";

  setSessionTimeout(userId);

  await ctx.reply(
    data.language === "hi"
      ? "अपनी जन्म तिथि DD-MM-YYYY फॉर्मेट में दर्ज करें।\nउदाहरण: 15-08-1995"
      : "Enter your Date of Birth in DD-MM-YYYY format.\nExample: 15-08-1995"
  );

  return;
}

  if (data?.step === "forgot_uan") {
  const uan = ctx.message.text.trim();

  if (!/^\d{12}$/.test(uan)) {
    await ctx.reply(
      data.language === "hi"
        ? "❌ कृपया सही 12 अंकों का UAN दर्ज करें।"
        : "❌ Please enter a valid 12-digit UAN."
    );

    return;
  }

  data.uan = uan;
  data.step = "forgot_name";

  setSessionTimeout(userId);

  await ctx.reply(
    data.language === "hi"
      ? "कृपया EPFO रिकॉर्ड के अनुसार अपना पूरा नाम दर्ज करें।"
      : "Please enter your full name exactly as per EPFO records."
  );

  return;
}

  if (!data) {
    return;
  }

  setSessionTimeout(userId);

  const text = ctx.message.text.trim();


  // -----------------------------
  // STEP 1: UAN
  // -----------------------------

  if (data.step === "awaiting_uan") {
    const uan = text.replace(/\s+/g, "");

    if (!/^\d{12}$/.test(uan)) {
      if (data.language === "hi") {
        await ctx.reply("कृपया valid 12-digit UAN Number भेजें।");
      } else {
        await ctx.reply("Please enter a valid 12-digit UAN Number.");
      }

      return;
    }

    data.uan = uan;
    data.step = "awaiting_password";

    // await safelyDeleteMessage(ctx);

    if (data.language === "hi") {
      await ctx.reply(
        "अब अपना EPFO Password भेजें।\n\nPassword processing के बाद save नहीं किया जाएगा।"
      );
    } else {
      await ctx.reply(
        "Now send your EPFO Password.\n\nThe password will not be saved after processing."
      );
    }

    return;
  }


  // -----------------------------
  // STEP 2: PASSWORD
  // -----------------------------

 if (data.step === "awaiting_password") {
  const password = text;

  // Password Telegram chat se processing ke baad remove karenge.
  await safelyDeleteMessage(ctx);

  if (!password) {
    await ctx.reply("Password cannot be empty.");
    return;
  }

  data.step = "creating_session";

  try {
    let captchaBuffer;

    // First attempt
    if (!data.passbookSession) {
      if (data.language === "hi") {
        await ctx.reply("EPFO Passbook खोल रहा हूँ...");
      } else {
        await ctx.reply("Opening EPFO Passbook...");
      }

      const passbookSession = await createPassbookSession(
        data.uan,
        password
      );

      data.passbookSession = passbookSession;
      captchaBuffer = passbookSession.captchaBuffer;
    }

    // Password retry - same UAN/session
    else {
      if (data.language === "hi") {
        await ctx.reply("नए Password के साथ दोबारा कोशिश कर रहा हूँ...");
      } else {
        await ctx.reply("Trying again with the new password...");
      }

      captchaBuffer = await retryPassword(
        data.passbookSession,
        password
      );
    }

    data.step = "awaiting_captcha";

    if (data.language === "hi") {
      await ctx.replyWithPhoto(
        { source: captchaBuffer },
        {
          caption:
            "CAPTCHA देखकर text भेजें।",
        }
      );
    } else {
      await ctx.replyWithPhoto(
        { source: captchaBuffer },
        {
          caption:
            "Please read the CAPTCHA and send the text.",
        }
      );
    }
  } catch (error) {
    console.error(
      "Passbook password/session error:",
      error.message
    );

    await cleanupUserSession(userId);

    if (data.language === "hi") {
      await ctx.reply(
        "EPFO Passbook खोलने में समस्या आई। कृपया Check Balance दोबारा शुरू करें।"
      );
    } else {
      await ctx.reply(
        "There was a problem opening EPFO Passbook. Please start Check Balance again."
      );
    }
  }

  return;
}


  // -----------------------------
  // STEP 3: CAPTCHA
  // -----------------------------

 if (data.step === "awaiting_captcha") {
  const captcha = text;

  await safelyDeleteMessage(ctx);

  data.step = "logging_in";

  if (data.language === "hi") {
    await ctx.reply("Login verify कर रहा हूँ...");
  } else {
    await ctx.reply("Verifying login...");
  }

  try {
    const result = await submitCaptcha(
      data.passbookSession,
      captcha
    );

    // LOGIN SUCCESS
if (result.success) {
  await ctx.reply(
    "✅ EPFO Passbook Login Successful"
  );

  await ctx.reply(
    "⏳ Fetching your PF account details..."
  );

  try {
    const accounts =
      await getPfAccountDetails(
        data.passbookSession
      );

    if (!accounts.length) {
      await ctx.reply(
        "❌ No PF account details found."
      );

      await cleanupUserSession(userId);
      return;
    }


    const formatAmount = (amount) => {
      if (
        amount === null ||
        amount === undefined
      ) {
        return "Not available";
      }

      return (
        "₹" +
        Number(amount).toLocaleString(
          "en-IN"
        )
      );
    };

let message =
  "📘 <b>PF ACCOUNT DETAILS</b>\n\n";

accounts.forEach((account, index) => {
  message +=
    `${index + 1}. ${account.companyName}\n`;

  message +=
    `Member ID: ${account.memberId}\n\n`;

  if (account.lastContributionMonth) {
    message +=
      `📅 Last Contribution Month: <b>${account.lastContributionMonth}</b>\n\n`;
  }

  if (account.balanceAvailable) {
    message +=
      `Employee Share: ${formatAmount(account.employeeShare)}\n`;

    message +=
      `Employer Share: ${formatAmount(account.employerShare)}\n\n`;

    message +=
      `💰 <b>TOTAL PF BALANCE: ${formatAmount(account.pfBalance)}</b>\n`;

    message +=
      `🏦 <b>PENSION SHARE: ${formatAmount(account.pensionShare)}</b>\n`;
  } else {
    message +=
      `💰 <b>TOTAL PF BALANCE: Not available</b>\n`;

    message +=
      `🏦 <b>PENSION SHARE: Not available</b>\n`;
  }

  message += "\n";
});


await ctx.reply(message, {
  parse_mode: "HTML",
});

try {
  await recordUsage(
    userId,
    "check_balance",
    "success"
  );
} catch (error) {
  console.error(
    "Usage tracking failed:",
    error.message
  );
}

const language = data.language;

await cleanupUserSession(userId);

await showTaskEndOptions(
  ctx,
  language
);

} catch (error) {
    console.error(
      "PF details error:",
      error.message
    );

    await ctx.reply(
      "❌ Unable to fetch PF details right now. Please try again."
    );

    await cleanupUserSession(userId);
  }

  return;
}
    // WRONG CAPTCHA
    if (result.reason === "captcha") {
      data.step = "awaiting_captcha";

      if (data.language === "hi") {
        await ctx.replyWithPhoto(
          { source: result.captchaBuffer },
          {
            caption:
              "❌ CAPTCHA गलत था। नया CAPTCHA देखकर दोबारा भेजें।",
          }
        );
      } else {
        await ctx.replyWithPhoto(
          { source: result.captchaBuffer },
          {
            caption:
              "❌ Incorrect CAPTCHA. Please enter the new CAPTCHA.",
          }
        );
      }

      return;
    }

    // WRONG UAN / PASSWORD
if (result.reason === "credentials") {
  data.credentialAttempts = (data.credentialAttempts || 0) + 1;

  // =============================
  // FIRST WRONG ATTEMPT
  // Same UAN, ask password again
  // =============================

  if (data.credentialAttempts < 2) {
    data.step = "awaiting_password";

    if (data.language === "hi") {
      await ctx.reply(
        "❌ UAN या Password गलत है।\n\nकृपया सही Password दोबारा भेजें।"
      );
    } else {
      await ctx.reply(
        "❌ UAN or Password is incorrect.\n\nPlease send the correct password again."
      );
    }

    return;
  }


  // =============================
  // SECOND WRONG ATTEMPT
  // Close everything and start fresh
  // =============================

  const language = data.language;

  await cleanupUserSession(userId);

  userSessions.set(userId, {
    language,
    step: "awaiting_uan",
    credentialAttempts: 0,
  });

  setSessionTimeout(userId);

  if (language === "hi") {
    await ctx.reply(
      "❌ Details दो बार गलत दर्ज हुई हैं।\n\nकृपया अपना UAN Number फिर से दर्ज करें।"
    );
  } else {
    await ctx.reply(
      "❌ Incorrect details were entered twice.\n\nPlease enter your UAN Number again."
    );
  }

  return;
}

    // UNKNOWN LOGIN FAILURE
    data.step = "awaiting_password";

    if (data.language === "hi") {
      await ctx.reply(
        "Login नहीं हुआ। कृपया Password दोबारा भेजें।"
      );
    } else {
      await ctx.reply(
        "Login was not successful. Please send your password again."
      );
    }

  } catch (error) {
    console.error(
      "Login error:",
      error.message
    );

    await cleanupUserSession(userId);

    if (data.language === "hi") {
      await ctx.reply(
        "Login process में technical problem आई। कृपया Check Balance दोबारा शुरू करें।"
      );
    } else {
      await ctx.reply(
        "There was a technical problem during login. Please start Check Balance again."
      );
    }
  }

  return;
}
});
});


// =============================
// ERROR HANDLING
// =============================

bot.catch((error) => {
  console.error("Telegram bot error:", error.message);
});


// =============================
// START BOT
// =============================

bot.launch()
  .then(() => {
    console.log("PF SAATHI Bot is running...");
  })
  .catch((error) => {
    console.error("Bot failed to start:", error.message);
  });

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));