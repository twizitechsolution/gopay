-- ==============================================================================
-- AIRWALLEX PRODUCTION DATABASE SCHEMA FOR SUPABASE (POSTGRESQL)
-- ==============================================================================

-- 1. USERS TABLE
CREATE TABLE IF NOT EXISTS users (
    id BIGINT PRIMARY KEY,
    uid VARCHAR(50) UNIQUE NOT NULL,
    mobile VARCHAR(20) UNIQUE NOT NULL,
    username VARCHAR(100),
    password_hash TEXT,
    pin VARCHAR(20),
    ref_code VARCHAR(50),
    parent_id BIGINT,
    inr_balance NUMERIC(15, 2) DEFAULT 0.00,
    bcoin_balance NUMERIC(15, 2) DEFAULT 0.00,
    usdt_balance NUMERIC(15, 2) DEFAULT 0.00,
    total_earnings NUMERIC(15, 2) DEFAULT 0.00,
    today_profit NUMERIC(15, 2) DEFAULT 0.00,
    yesterday_profit NUMERIC(15, 2) DEFAULT 0.00,
    is_blocked BOOLEAN DEFAULT FALSE,
    fcm_tokens JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_mobile ON users(mobile);
CREATE INDEX IF NOT EXISTS idx_users_uid ON users(uid);
CREATE INDEX IF NOT EXISTS idx_users_ref_code ON users(ref_code);
CREATE INDEX IF NOT EXISTS idx_users_is_blocked ON users(is_blocked);

-- 2. BANK ACCOUNTS TABLE
CREATE TABLE IF NOT EXISTS bank_accounts (
    id BIGINT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    bank_name VARCHAR(100),
    account_holder VARCHAR(100),
    account_number VARCHAR(100),
    ifsc_code VARCHAR(50),
    status VARCHAR(50) DEFAULT 'Active',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bank_accounts_user_id ON bank_accounts(user_id);

-- 3. ORDERS (DEPOSITS) TABLE
CREATE TABLE IF NOT EXISTS orders (
    id BIGINT PRIMARY KEY,
    order_id VARCHAR(100) UNIQUE NOT NULL,
    user_id BIGINT NOT NULL,
    asset_type VARCHAR(20) DEFAULT 'INR',
    amount NUMERIC(15, 2) NOT NULL,
    expected_income NUMERIC(15, 2) DEFAULT 0.00,
    quota NUMERIC(15, 2) DEFAULT 0.00,
    status VARCHAR(50) DEFAULT 'Confirming',
    utr VARCHAR(100),
    receiver_id BIGINT,
    withdrawal_id BIGINT,
    timer_expiry TIMESTAMPTZ,
    receiver_details JSONB,
    screenshot_path TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_order_id ON orders(order_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);

-- 4. WITHDRAWALS TABLE
CREATE TABLE IF NOT EXISTS withdrawals (
    id BIGINT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    amount NUMERIC(15, 2) NOT NULL,
    amount_pending NUMERIC(15, 2) DEFAULT 0.00,
    status VARCHAR(50) DEFAULT 'Pending',
    bank_account_id BIGINT,
    utr VARCHAR(100),
    txid VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_withdrawals_user_id ON withdrawals(user_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);
CREATE INDEX IF NOT EXISTS idx_withdrawals_created_at ON withdrawals(created_at);

-- 5. TRANSACTIONS TABLE
CREATE TABLE IF NOT EXISTS transactions (
    id BIGINT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    type VARCHAR(50) NOT NULL,
    amount NUMERIC(15, 2) NOT NULL,
    balance_after NUMERIC(15, 2) DEFAULT 0.00,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at);

-- 6. DISPUTES TABLE
CREATE TABLE IF NOT EXISTS disputes (
    id BIGINT PRIMARY KEY,
    order_id VARCHAR(100),
    raiser_id BIGINT,
    reason TEXT,
    proof_path TEXT,
    status VARCHAR(50) DEFAULT 'Pending',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. MESSAGES TABLE
CREATE TABLE IF NOT EXISTS messages (
    id BIGINT PRIMARY KEY,
    title VARCHAR(200),
    content TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. PRODUCTS TABLE
CREATE TABLE IF NOT EXISTS products (
    id BIGINT PRIMARY KEY,
    name VARCHAR(100),
    amount NUMERIC(15, 2) NOT NULL,
    income NUMERIC(15, 2) DEFAULT 0.00,
    quota NUMERIC(15, 2) DEFAULT 0.00,
    color VARCHAR(50),
    type VARCHAR(50),
    percent VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. SETTINGS & APP CONFIG
CREATE TABLE IF NOT EXISTS settings (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. ADMIN USERS TABLE
CREATE TABLE IF NOT EXISTS admin_users (
    username VARCHAR(100) PRIMARY KEY,
    password TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure default admin user
INSERT INTO admin_users (username, password)
VALUES ('airwallexusadmin', 'airwallexus@143#!')
ON CONFLICT (username) DO NOTHING;
