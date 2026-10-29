const { pool } = require("../db/database");

async function registerUser(
  telegramUserId,
  language = null
) {
  await pool.query(
    `
    INSERT INTO users (
      telegram_user_id,
      language
    )
    VALUES ($1, $2)

    ON CONFLICT (telegram_user_id)
    DO UPDATE SET
      language = COALESCE(
        EXCLUDED.language,
        users.language
      ),
      last_seen = NOW()
    `,
    [
      String(telegramUserId),
      language,
    ]
  );
}

async function recordUsage(
  telegramUserId,
  feature,
  status = "success"
) {
  await pool.query(
    `
    INSERT INTO usage_events (
      telegram_user_id,
      feature,
      status
    )
    VALUES ($1, $2, $3)
    `,
    [
      String(telegramUserId),
      feature,
      status,
    ]
  );
}

function getPeriodStart(period) {
  switch (period) {
    case "today":
      return "DATE_TRUNC('day', NOW())";

    case "weekly":
      return "NOW() - INTERVAL '7 days'";

    case "monthly":
      return "NOW() - INTERVAL '30 days'";

    case "yearly":
      return "NOW() - INTERVAL '365 days'";

    default:
      throw new Error("Invalid analytics period");
  }
}

async function getUserStats(period) {
  const periodStart = getPeriodStart(period);

  const result = await pool.query(
    `
    WITH active_users AS (
      SELECT DISTINCT telegram_user_id
      FROM usage_events
      WHERE
        status = 'success'
        AND created_at >= ${periodStart}
    )

    SELECT
      (
        SELECT COUNT(*)
        FROM users
        WHERE first_seen >= ${periodStart}
      ) AS new_users,

      (
        SELECT COUNT(*)
        FROM active_users au
        JOIN users u
          ON u.telegram_user_id =
             au.telegram_user_id
        WHERE u.first_seen < ${periodStart}
      ) AS existing_users,

      (
        SELECT COUNT(*)
        FROM active_users
      ) AS active_users,

      (
        SELECT COUNT(*)
        FROM users
      ) AS all_users
    `
  );

  return {
    newUsers: Number(result.rows[0].new_users),
    existingUsers: Number(
      result.rows[0].existing_users
    ),
    activeUsers: Number(
      result.rows[0].active_users
    ),
    allUsers: Number(result.rows[0].all_users),
  };
}

async function getUsageStats(period) {
  const periodStart = getPeriodStart(period);

  const result = await pool.query(
    `
    SELECT
      COUNT(*) FILTER (
        WHERE feature = 'check_balance'
        AND status = 'success'
      ) AS check_balance,

      COUNT(*) FILTER (
        WHERE feature = 'forgot_password'
        AND status = 'success'
      ) AS forgot_password

    FROM usage_events
    WHERE created_at >= ${periodStart}
    `
  );

  return {
    checkBalance: Number(
      result.rows[0].check_balance
    ),
    forgotPassword: Number(
      result.rows[0].forgot_password
    ),
  };
}

module.exports = {
  registerUser,
  recordUsage,
  getUserStats,
  getUsageStats,
};