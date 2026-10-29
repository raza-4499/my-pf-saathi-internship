CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    telegram_user_id BIGINT UNIQUE NOT NULL,
    language VARCHAR(10),
    first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS usage_events (
    id BIGSERIAL PRIMARY KEY,
    telegram_user_id BIGINT NOT NULL,
    feature VARCHAR(50) NOT NULL,
    status VARCHAR(20),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscriptions (
    id BIGSERIAL PRIMARY KEY,
    telegram_user_id BIGINT NOT NULL,
    status VARCHAR(20) NOT NULL,
    plan VARCHAR(50),
    starts_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
    id BIGSERIAL PRIMARY KEY,
    telegram_user_id BIGINT NOT NULL,
    provider VARCHAR(50),
    telegram_payment_charge_id TEXT UNIQUE,
    stars_amount INTEGER,
    status VARCHAR(20),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_events_user
ON usage_events (telegram_user_id);

CREATE INDEX IF NOT EXISTS idx_usage_events_created
ON usage_events (created_at);

CREATE INDEX IF NOT EXISTS idx_usage_events_feature
ON usage_events (feature);

CREATE INDEX IF NOT EXISTS idx_users_first_seen
ON users (first_seen);

CREATE INDEX IF NOT EXISTS idx_users_last_seen
ON users (last_seen);