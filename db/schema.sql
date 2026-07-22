-- MarketOS SQLite Schema
-- Version 1.0

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ============================================================
-- USERS & AUTHENTICATION
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL
);

-- ============================================================
-- BUSINESSES
-- ============================================================

CREATE TABLE IF NOT EXISTS businesses (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    location TEXT NOT NULL DEFAULT '',
    currency TEXT NOT NULL DEFAULT 'NGN',
    language TEXT NOT NULL DEFAULT 'English',
    offline_mode INTEGER NOT NULL DEFAULT 1,
    cloud_sync INTEGER NOT NULL DEFAULT 0,
    backup_location TEXT NOT NULL DEFAULT '',
    last_backup TEXT,
    -- Business profile fields for future AI features
    industry TEXT NOT NULL DEFAULT '',
    business_type TEXT NOT NULL DEFAULT '',
    target_customer TEXT NOT NULL DEFAULT '',
    goals TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE INDEX idx_businesses_user_id ON businesses(user_id);

-- ============================================================
-- PRODUCTS
-- ============================================================

CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    stock INTEGER NOT NULL DEFAULT 0,
    cost_price REAL NOT NULL DEFAULT 0,
    sell_price REAL NOT NULL DEFAULT 0,
    damaged INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE INDEX idx_products_business_id ON products(business_id);

-- ============================================================
-- SUPPLIERS
-- ============================================================

CREATE TABLE IF NOT EXISTS suppliers (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    contact TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE INDEX idx_suppliers_business_id ON suppliers(business_id);

-- ============================================================
-- CUSTOMERS
-- ============================================================

CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    debt REAL NOT NULL DEFAULT 0,
    last_activity TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Active',
    created_at TEXT NOT NULL
);

CREATE INDEX idx_customers_business_id ON customers(business_id);

CREATE TABLE IF NOT EXISTS customer_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    type TEXT NOT NULL,
    amount REAL NOT NULL,
    note TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_customer_history_customer_id ON customer_history(customer_id);

-- ============================================================
-- SALES (transaction header)
-- ============================================================

CREATE TABLE IF NOT EXISTS sales (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT 'Cash',
    customer TEXT NOT NULL DEFAULT '',
    customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
    total_amount REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE INDEX idx_sales_business_id ON sales(business_id);
CREATE INDEX idx_sales_customer_id ON sales(customer_id);

-- ============================================================
-- SALE ITEMS (line items)
-- ============================================================

CREATE TABLE IF NOT EXISTS sale_items (
    id TEXT PRIMARY KEY,
    sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    product TEXT NOT NULL DEFAULT '',
    quantity INTEGER NOT NULL DEFAULT 0,
    unit_price REAL NOT NULL DEFAULT 0,
    line_total REAL NOT NULL DEFAULT 0
);

CREATE INDEX idx_sale_items_sale_id ON sale_items(sale_id);

-- ============================================================
-- EXPENSES
-- ============================================================

CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    category TEXT NOT NULL,
    amount REAL NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'Paid',
    created_at TEXT NOT NULL
);

CREATE INDEX idx_expenses_business_id ON expenses(business_id);

-- ============================================================
-- INVOICES
-- ============================================================

CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    number TEXT NOT NULL,
    date TEXT NOT NULL,
    customer_name TEXT NOT NULL DEFAULT '',
    due_date TEXT NOT NULL,
    item TEXT NOT NULL DEFAULT '',
    quantity INTEGER NOT NULL DEFAULT 0,
    unit_price REAL NOT NULL DEFAULT 0,
    amount_paid REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'Saved',
    created_at TEXT NOT NULL
);

CREATE INDEX idx_invoices_business_id ON invoices(business_id);

-- ============================================================
-- NOTES
-- ============================================================

CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    note TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Saved',
    created_at TEXT NOT NULL
);

CREATE INDEX idx_notes_business_id ON notes(business_id);

-- ============================================================
-- KNOWLEDGE BASE
-- ============================================================

CREATE TABLE IF NOT EXISTS knowledge (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual',
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX idx_knowledge_business_id ON knowledge(business_id);

-- ============================================================
-- INVENTORY TRANSACTIONS (audit trail)
-- ============================================================

CREATE TABLE IF NOT EXISTS inventory_transactions (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_cost REAL NOT NULL DEFAULT 0,
    reference_type TEXT,
    reference_id TEXT,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE INDEX idx_inventory_transactions_business_id ON inventory_transactions(business_id);
CREATE INDEX idx_inventory_transactions_product_id ON inventory_transactions(product_id);
CREATE INDEX idx_inventory_transactions_type ON inventory_transactions(type);

-- ============================================================
-- SYSTEM PERFORMANCE (not per-business)
-- ============================================================

CREATE TABLE IF NOT EXISTS system_performance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    runtime TEXT NOT NULL DEFAULT 'local',
    model TEXT,
    quantization TEXT,
    context_window INTEGER,
    threads INTEGER,
    ram_usage_gb REAL,
    peak_ram_gb REAL,
    tokens_per_second REAL,
    extraction_seconds REAL,
    rag_seconds REAL,
    cpu_temperature_c REAL,
    last_benchmark TEXT
);
