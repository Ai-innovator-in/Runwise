import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'data', 'marketos.db');

console.log('=== SQLite Validation Report ===');
console.log(`Database: ${dbPath}\n`);

const db = new Database(dbPath);

try {
  // Row counts for all tables
  console.log('--- Row Counts ---');
  const tables = [
    'users', 'sessions', 'businesses', 'products', 'suppliers',
    'customers', 'customer_history', 'sales', 'sale_items',
    'expenses', 'invoices', 'notes', 'knowledge',
    'inventory_transactions', 'system_performance'
  ];
  for (const table of tables) {
    const row = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get();
    console.log(`${table}: ${row.count}`);
  }
  console.log('');

  // 1. Sample business record
  console.log('--- Sample Business Record ---');
  const business = db.prepare('SELECT * FROM businesses LIMIT 1').get();
  console.log(JSON.stringify(business, null, 2));
  console.log('');

  // 2. Sample products
  console.log('--- Sample Products (up to 5) ---');
  const products = db.prepare('SELECT * FROM products LIMIT 5').all();
  for (const product of products) {
    console.log(JSON.stringify(product, null, 2));
  }
  console.log('');

  // 3. Sales joined with sale_items
  console.log('--- Sales with Sale Items ---');
  const sales = db.prepare(`
    SELECT s.id AS sale_id, s.date, s.channel, s.customer, s.total_amount,
           si.id AS item_id, si.product, si.quantity, si.unit_price, si.line_total
    FROM sales s
    JOIN sale_items si ON si.sale_id = s.id
    ORDER BY s.date DESC
    LIMIT 7
  `).all();
  for (const sale of sales) {
    console.log(JSON.stringify(sale, null, 2));
  }
  console.log('');

  // 4. Inventory transactions
  console.log('--- Inventory Transactions ---');
  const invtx = db.prepare('SELECT * FROM inventory_transactions LIMIT 8').all();
  for (const tx of invtx) {
    console.log(JSON.stringify(tx, null, 2));
  }
  console.log('');

  // 5. Foreign key validation
  console.log('--- Foreign Key Validation ---');
  const violations = db.prepare('PRAGMA foreign_key_check').all();
  if (violations.length === 0) {
    console.log('✅ No foreign key violations found.');
  } else {
    console.log(`❌ Found ${violations.length} foreign key violation(s):`);
    for (const v of violations) {
      console.log(JSON.stringify(v, null, 2));
    }
  }
  console.log('');

  console.log('=== Validation Complete ===');
} finally {
  db.close();
}
