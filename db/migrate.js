import { getDatabase } from './index.js';

/**
 * Migrate data from the JSON database object to SQLite.
 * This is a one-time migration that runs when the JSON file exists
 * and the SQLite database is empty.
 *
 * @param {Object} jsonDb - The parsed JSON database object
 * @returns {Promise<Object>} Migration result with counts
 */
export async function migrateFromJson(jsonDb) {
  const db = getDatabase();
  const result = {
    users: 0,
    sessions: 0,
    businesses: 0,
    products: 0,
    suppliers: 0,
    customers: 0,
    customerHistory: 0,
    sales: 0,
    saleItems: 0,
    expenses: 0,
    invoices: 0,
    notes: 0,
    knowledge: 0,
    inventoryTransactions: 0,
    performance: 0,
  };

  // Check if migration already happened
  const existingUsers = db.prepare('SELECT COUNT(*) as count FROM users').get();
  if (existingUsers.count > 0) {
    console.log('[MIGRATE] Database already has data, skipping migration.');
    return result;
  }

  const insertUser = db.prepare(`
    INSERT INTO users (id, name, email, password_hash, created_at)
    VALUES (@id, @name, @email, @passwordHash, @createdAt)
  `);

  const insertSession = db.prepare(`
    INSERT INTO sessions (token, user_id, created_at)
    VALUES (@token, @userId, @createdAt)
  `);

  const insertBusiness = db.prepare(`
    INSERT INTO businesses (
      id, user_id, name, location, currency, language,
      offline_mode, cloud_sync, backup_location, last_backup,
      industry, business_type, target_customer, goals, created_at
    ) VALUES (
      @id, @userId, @name, @location, @currency, @language,
      @offlineMode, @cloudSync, @backupLocation, @lastBackup,
      @industry, @businessType, @targetCustomer, @goals, @createdAt
    )
  `);

  const insertProduct = db.prepare(`
    INSERT INTO products (id, business_id, name, stock, cost_price, sell_price, damaged, created_at)
    VALUES (@id, @businessId, @name, @stock, @costPrice, @sellPrice, @damaged, @createdAt)
  `);

  const insertCustomer = db.prepare(`
    INSERT INTO customers (id, business_id, name, debt, last_activity, status, created_at)
    VALUES (@id, @businessId, @name, @debt, @lastActivity, @status, @createdAt)
  `);

  const insertCustomerHistory = db.prepare(`
    INSERT INTO customer_history (customer_id, date, type, amount, note)
    VALUES (@customerId, @date, @type, @amount, @note)
  `);

  const insertSale = db.prepare(`
    INSERT INTO sales (id, business_id, date, channel, customer, customer_id, total_amount, created_at)
    VALUES (@id, @businessId, @date, @channel, @customer, @customerId, @totalAmount, @createdAt)
  `);

  const insertSaleItem = db.prepare(`
    INSERT INTO sale_items (id, sale_id, product, quantity, unit_price, line_total)
    VALUES (@id, @saleId, @product, @quantity, @unitPrice, @lineTotal)
  `);

  const insertExpense = db.prepare(`
    INSERT INTO expenses (id, business_id, date, category, amount, note, status, created_at)
    VALUES (@id, @businessId, @date, @category, @amount, @note, @status, @createdAt)
  `);

  const insertInvoice = db.prepare(`
    INSERT INTO invoices (id, business_id, number, date, customer_name, due_date, item, quantity, unit_price, amount_paid, status, created_at)
    VALUES (@id, @businessId, @number, @date, @customerName, @dueDate, @item, @quantity, @unitPrice, @amountPaid, @status, @createdAt)
  `);

  const insertNote = db.prepare(`
    INSERT INTO notes (id, business_id, note, status, created_at)
    VALUES (@id, @businessId, @note, @status, @createdAt)
  `);

  const insertKnowledge = db.prepare(`
    INSERT INTO knowledge (id, business_id, title, source, body, created_at)
    VALUES (@id, @businessId, @title, @source, @body, @createdAt)
  `);

  const insertInventoryTransaction = db.prepare(`
    INSERT INTO inventory_transactions (id, business_id, product_id, type, quantity, unit_cost, reference_type, reference_id, note, created_at)
    VALUES (@id, @businessId, @productId, @type, @quantity, @unitCost, @referenceType, @referenceId, @note, @createdAt)
  `);

  const insertPerformance = db.prepare(`
    INSERT INTO system_performance (
      runtime, model, quantization, context_window, threads,
      ram_usage_gb, peak_ram_gb, tokens_per_second,
      extraction_seconds, rag_seconds, cpu_temperature_c, last_benchmark
    ) VALUES (
      @runtime, @model, @quantization, @contextWindow, @threads,
      @ramUsageGb, @peakRamGb, @tokensPerSecond,
      @extractionSeconds, @ragSeconds, @cpuTemperatureC, @lastBenchmark
    )
  `);

  const transaction = db.transaction(() => {
    // Migrate users
    for (const user of jsonDb.users || []) {
      insertUser.run({
        id: user.id,
        name: user.name,
        email: user.email,
        passwordHash: user.passwordHash,
        createdAt: user.createdAt,
      });
      result.users++;

      // Create business for each user
      const data = user.data || {};
      const settings = data.settings || {};
      const businessId = `biz_${user.id}`;

      insertBusiness.run({
        id: businessId,
        userId: user.id,
        name: settings.businessName || '',
        location: settings.location || '',
        currency: settings.currency || 'NGN',
        language: settings.language || 'English',
        offlineMode: settings.offlineMode ? 1 : 0,
        cloudSync: settings.cloudSync ? 1 : 0,
        backupLocation: settings.backupLocation || '',
        lastBackup: settings.lastBackup || null,
        industry: '',
        businessType: '',
        targetCustomer: '',
        goals: '',
        createdAt: user.createdAt,
      });
      result.businesses++;

      // Migrate products
      for (const product of data.inventory || []) {
        insertProduct.run({
          id: product.id,
          businessId,
          name: product.name,
          stock: product.stock || 0,
          costPrice: product.costPrice || 0,
          sellPrice: product.sellPrice || 0,
          damaged: product.damaged || 0,
          createdAt: user.createdAt,
        });
        result.products++;

        // Create initial inventory transaction for existing stock
        if (product.stock > 0) {
          insertInventoryTransaction.run({
            id: `invtx_${product.id}_init`,
            businessId,
            productId: product.id,
            type: 'adjustment',
            quantity: product.stock,
            unitCost: product.costPrice || 0,
            referenceType: 'migration',
            referenceId: null,
            note: 'Initial stock from JSON migration',
            createdAt: user.createdAt,
          });
          result.inventoryTransactions++;
        }

        // Create inventory transaction for damaged stock
        if (product.damaged > 0) {
          insertInventoryTransaction.run({
            id: `invtx_${product.id}_damaged`,
            businessId,
            productId: product.id,
            type: 'damage',
            quantity: -product.damaged,
            unitCost: product.costPrice || 0,
            referenceType: 'migration',
            referenceId: null,
            note: 'Damaged stock from JSON migration',
            createdAt: user.createdAt,
          });
          result.inventoryTransactions++;
        }
      }

      // Migrate customers
      for (const customer of data.customers || []) {
        insertCustomer.run({
          id: customer.id,
          businessId,
          name: customer.name,
          debt: customer.debt || 0,
          lastActivity: customer.lastActivity || '',
          status: customer.status || 'Active',
          createdAt: user.createdAt,
        });
        result.customers++;

        // Migrate customer history
        for (const entry of customer.history || []) {
          insertCustomerHistory.run({
            customerId: customer.id,
            date: entry.date || '',
            type: entry.type || '',
            amount: entry.amount || 0,
            note: entry.note || '',
          });
          result.customerHistory++;
        }
      }

      // Migrate sales
      for (const sale of data.sales || []) {
        const totalAmount = (sale.quantity || 0) * (sale.unitPrice || 0);

        insertSale.run({
          id: sale.id,
          businessId,
          date: sale.date || '',
          channel: sale.channel || 'Cash',
          customer: sale.customer || '',
          customerId: null,
          totalAmount,
          createdAt: user.createdAt,
        });
        result.sales++;

        // Create sale item
        insertSaleItem.run({
          id: `si_${sale.id}`,
          saleId: sale.id,
          product: sale.product || '',
          quantity: sale.quantity || 0,
          unitPrice: sale.unitPrice || 0,
          lineTotal: totalAmount,
        });
        result.saleItems++;

        // Create inventory transaction for sale
        if (sale.product && sale.quantity > 0) {
          const product = data.inventory.find(
            (p) => p.name.toLowerCase() === (sale.product || '').toLowerCase()
          );
          if (product) {
            insertInventoryTransaction.run({
              id: `invtx_${sale.id}`,
              businessId,
              productId: product.id,
              type: 'sale',
              quantity: -(sale.quantity || 0),
              unitCost: product.costPrice || 0,
              referenceType: 'sale',
              referenceId: sale.id,
              note: `Sale of ${sale.product}`,
              createdAt: user.createdAt,
            });
            result.inventoryTransactions++;
          }
        }
      }

      // Migrate expenses
      for (const expense of data.expenses || []) {
        insertExpense.run({
          id: expense.id,
          businessId,
          date: expense.date || '',
          category: expense.category || '',
          amount: expense.amount || 0,
          note: expense.note || '',
          status: expense.status || 'Paid',
          createdAt: user.createdAt,
        });
        result.expenses++;
      }

      // Migrate invoices
      for (const invoice of data.invoices || []) {
        insertInvoice.run({
          id: invoice.id,
          businessId,
          number: invoice.number || '',
          date: invoice.date || '',
          customerName: invoice.customerName || '',
          dueDate: invoice.dueDate || '',
          item: invoice.item || '',
          quantity: invoice.quantity || 0,
          unitPrice: invoice.unitPrice || 0,
          amountPaid: invoice.amountPaid || 0,
          status: invoice.status || 'Saved',
          createdAt: user.createdAt,
        });
        result.invoices++;
      }

      // Migrate notes
      for (const note of data.notes || []) {
        insertNote.run({
          id: note.id,
          businessId,
          note: note.note || '',
          status: note.status || 'Saved',
          createdAt: note.createdAt || user.createdAt,
        });
        result.notes++;
      }

      // Migrate knowledge
      for (const item of data.knowledge || []) {
        insertKnowledge.run({
          id: item.id,
          businessId,
          title: item.title || '',
          source: item.source || 'manual',
          body: item.body || '',
          createdAt: item.createdAt || user.createdAt,
        });
        result.knowledge++;
      }

      // Migrate performance (only once, from first user)
      if (data.performance && result.performance === 0) {
        const perf = data.performance;
        insertPerformance.run({
          runtime: perf.runtime || 'local',
          model: perf.model || null,
          quantization: perf.quantization || null,
          contextWindow: perf.contextWindow || null,
          threads: perf.threads || null,
          ramUsageGb: perf.ramUsageGb || null,
          peakRamGb: perf.peakRamGb || null,
          tokensPerSecond: perf.tokensPerSecond || null,
          extractionSeconds: perf.extractionSeconds || null,
          ragSeconds: perf.ragSeconds || null,
          cpuTemperatureC: perf.cpuTemperatureC || null,
          lastBenchmark: perf.lastBenchmark || null,
        });
        result.performance++;
      }
    }

    // Migrate sessions
    for (const [token, session] of Object.entries(jsonDb.sessions || {})) {
      insertSession.run({
        token,
        userId: session.userId,
        createdAt: session.createdAt,
      });
      result.sessions++;
    }
  });

  // Execute migration in a single transaction
  transaction();

  console.log('[MIGRATE] Migration completed:', JSON.stringify(result, null, 2));
  return result;
}

/**
 * Check if migration is needed by comparing JSON data with SQLite data.
 */
export function isMigrationNeeded(jsonDb) {
  const db = getDatabase();
  const count = db.prepare('SELECT COUNT(*) as count FROM users').get();
  return count.count === 0 && (jsonDb.users || []).length > 0;
}
