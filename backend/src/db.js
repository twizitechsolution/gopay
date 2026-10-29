require('dotenv').config();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const bundledDbPath = path.join(__dirname, '../data/database.json');
const dataDir = process.env.DATA_DIR || path.join(__dirname, '../data');
const dbPath = process.env.DATABASE_PATH || path.join(dataDir, 'database.json');

// Ensure database parent directory exists safely
const dbDir = path.dirname(dbPath);
try {
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
} catch (err) {}

// In-memory representation of our database tables
let dbData = {
  users: [],
  orders: [],
  bank_accounts: [],
  transactions: [],
  user_tasks: [],
  messages: [],
  withdrawals: [],
  disputes: [],
  settings: {
    level1_commission: 10,
    level2_commission: 5,
    level3_commission: 2,
    telegram_link: "https://t.me/Gopay",
    payment_mode: "gateway",
    upi_ids: ""
  }
};

// Autoincrement trackers
let idTrackers = {
  users: 0,
  orders: 0,
  bank_accounts: 0,
  transactions: 0,
  user_tasks: 0,
  messages: 0,
  withdrawals: 0,
  disputes: 0
};

// Unified Database Persistence (100% MySQL aaPanel Native)
async function persistToDb(table, record, operation = 'upsert', matchField = 'id') {
  try {
    const { isMysqlConnected, persistToMysql } = require('./mysql');
    if (isMysqlConnected() && record) {
      await persistToMysql(table, record, operation, matchField);
    }
  } catch (mErr) {
    console.error(`[MySQL Persist Error] ${table}:`, mErr.message);
  }
}
const persistToSupabase = persistToDb; // Backwards-compatible alias


function saveDb(entity = null) {
  if (!isDbLoaded) {
    loadDb();
  }
  if ((!dbData.users || dbData.users.length === 0) && fs.existsSync(bundledDbPath)) {
    console.warn('[DB] Safety block: Attempted to save empty users list. Aborting disk overwrite.');
    return;
  }
  try {
    fs.writeFileSync(dbPath, JSON.stringify({ dbData, idTrackers }, null, 2), 'utf8');
  } catch (err) {
    // Disk write fallback
  }

  
  if (entity && entity.table && entity.record) {
    persistToDb(entity.table, entity.record, entity.operation || 'upsert', entity.matchField || 'id');
  }

  // Always keep settings & admin configuration saved in MySQL
  try {
    const { isMysqlConnected, persistToMysql } = require('./mysql');
    if (isMysqlConnected()) {
      if (dbData.settings) {
        persistToMysql('settings', {
          key: 'config',
          value: JSON.stringify(dbData.settings)
        }, 'upsert', 'key').catch(() => {});
      }
      if (dbData.admin) {
        persistToMysql('settings', {
          key: 'admin',
          value: JSON.stringify(dbData.admin)
        }, 'upsert', 'key').catch(() => {});
      }
    }
  } catch (e) {}
}

function repairMissingCommissions() {
  let repairedCount = 0;
  
  const completedOrders = dbData.orders.filter(o => o.status === 'Completed');
  const rates = dbData.settings || { level1_commission: 10, level2_commission: 5, level3_commission: 2 };
  const commissionRates = [
    Number(rates.level1_commission || 0) / 100,
    Number(rates.level2_commission || 0) / 100,
    Number(rates.level3_commission || 0) / 100
  ];

  for (const order of completedOrders) {
    const buyer = dbData.users.find(u => u.id == order.user_id);
    if (!buyer) continue;

    const depositAmountInInr = order.asset_type === 'USDT' ? order.amount * 100.0 : order.amount;
    let currentParentId = buyer.parent_id;

    for (let level = 1; level <= 3; level++) {
      if (!currentParentId) break;

      const parent = dbData.users.find(u => u.id == currentParentId);
      if (!parent) break;

      const rate = commissionRates[level - 1];
      const commAmount = depositAmountInInr * rate;

      if (commAmount > 0) {
        const searchDesc = `Level ${level} Commission of ₹${commAmount.toFixed(2)} from member UID: ${buyer.uid} (Order ID: ${order.order_id})`;
        
        // Check if transaction already exists for this parent and this order ID
        const exists = dbData.transactions.some(t => 
          t.user_id == parent.id && 
          t.type === 'Commission' && 
          t.description.includes(order.order_id)
        );

        if (!exists) {
          const newId = ++idTrackers.transactions;
          dbData.transactions.push({
            id: newId,
            user_id: parent.id,
            type: 'Commission',
            amount: commAmount,
            balance_after: parent.inr_balance, // fallback
            description: searchDesc,
            created_at: order.created_at || new Date().toISOString()
          });
          repairedCount++;
        }
      }

      currentParentId = parent.parent_id;
    }
  }

  if (repairedCount > 0) {
    console.log(`[Migration] Retroactively seeded ${repairedCount} missing commission transactions.`);
    saveDb();
  }
}

function repairWalletBalancesForOrders23And24() {
  dbData.settings = dbData.settings || {};
  if (dbData.settings.orders_repaired_v2) {
    return;
  }

  console.log('Running one-off wallet repair for Orders 23 & 24...');
  
  // Order 23: amount 500, quota 518.5, expected_income 18.5, user_id 3. Parent 1 commission: 50.
  const u3 = dbData.users.find(u => u.id == 3);
  const u1 = dbData.users.find(u => u.id == 1);

  if (u3) {
    u3.inr_balance += 1037.0; // 518.5 * 2 (for both orders 23 and 24)
    u3.total_earnings += 37.0; // 18.5 * 2
    u3.today_profit += 37.0; // 18.5 * 2
    console.log('Credited User 3 for Orders 23 & 24');
  }

  if (u1) {
    u1.inr_balance += 100.0; // 50.0 * 2 (for both orders 23 and 24)
    u1.total_earnings += 100.0; // 50.0 * 2
    u1.today_profit += 100.0; // 50.0 * 2
    console.log('Credited User 1 for Orders 23 & 24 commission');
  }

  dbData.settings.orders_repaired_v2 = true;
  saveDb();
}

function repairHistoryDepositSplits() {
  dbData.settings = dbData.settings || {};
  if (dbData.settings.history_split_repaired) {
    return;
  }

  console.log('Running retroactive history deposit/income splitting...');
  let splitCount = 0;
  const newTransactions = [];

  for (const t of dbData.transactions) {
    if (t.type === 'Deposit' && t.description && t.description.includes('Deposit completed for Order')) {
      // Find the order ID
      const match = t.description.match(/Order\s+([A-Za-z0-9]+)/);
      if (match && match[1]) {
        const orderId = match[1];
        const order = dbData.orders.find(o => o.order_id === orderId);
        if (order) {
          const principal = Number(order.amount);
          const bonus = Number(order.expected_income);
          
          if (bonus > 0 && Math.abs(t.amount - (principal + bonus)) < 0.01) {
            // Split it!
            const originalBalanceAfter = t.balance_after;
            
            // 1. Modify the existing transaction to be just the principal
            t.amount = principal;
            t.balance_after = originalBalanceAfter - bonus;
            t.description = `Deposit principal for Order ${order.order_id}`;

            // 2. Create the new commission transaction for the bonus
            const newId = ++idTrackers.transactions;
            newTransactions.push({
              id: newId,
              user_id: t.user_id,
              type: 'Commission',
              amount: bonus,
              balance_after: originalBalanceAfter,
              description: `Interest bonus for Order ${order.order_id}`,
              created_at: t.created_at
            });

            splitCount++;
          }
        }
      }
    }
  }

  if (newTransactions.length > 0) {
    dbData.transactions.push(...newTransactions);
    // Sort transactions by id to maintain chronological consistency
    dbData.transactions.sort((a, b) => a.id - b.id);
  }

  dbData.settings.history_split_repaired = true;
  if (splitCount > 0) {
    console.log(`Split ${splitCount} unified deposit transactions into principal and bonus entries.`);
    saveDb();
  }
}

function repairWithdrawalTransactionTypes() {
  dbData.settings = dbData.settings || {};

  let repairedCount = 0;
  for (const t of dbData.transactions) {
    if (t.type === 'Commission' && t.description && t.description.toLowerCase().includes('withdrawal')) {
      t.type = 'Withdraw';
      repairedCount++;
    }
  }

  let bankRepairedCount = 0;
  for (const t of dbData.transactions) {
    if (t.type === 'Withdraw') {
      if (!t.description.startsWith('Bank:')) {
        const bank = dbData.bank_accounts.find(a => a.user_id == t.user_id && a.status === 'Active');
        if (bank) {
          let utr = String(Math.floor(100000000000 + Math.random() * 900000000000));
          let txid = 'TXN' + String(Math.floor(1000000000 + Math.random() * 9000000000));
          const utrMatch = (t.description || '').match(/UTR:\s*([0-9a-zA-Z]+)/i);
          const txidMatch = (t.description || '').match(/TXID:\s*([0-9a-zA-Z]+)/i);
          if (utrMatch) utr = utrMatch[1];
          if (txidMatch) txid = txidMatch[1];
          
          const amt = Math.abs(t.amount);
          t.description = `Bank: ${bank.bank_name}, A/C: ${bank.account_number}, Holder: ${bank.account_holder}, UTR: ${utr}, TXID: ${txid}, Note: Debit withdrawal of ₹${amt.toFixed(2)} approved by administrator`;
          bankRepairedCount++;
        }
      }
    }
  }

  if (repairedCount > 0 || bankRepairedCount > 0) {
    console.log(`Withdrawal correction: converted ${repairedCount} types, reformatted ${bankRepairedCount} descriptions to active bank details.`);
    saveDb();
  }
}

// Load helper
let isDbLoaded = false;

function loadDb(force = false) {
  if (isDbLoaded && !force) {
    return;
  }

  let targetPath = dbPath;
  if (fs.existsSync(bundledDbPath)) {
    if (!fs.existsSync(dbPath)) {
      targetPath = bundledDbPath;
    } else {
      try {
        const curStat = fs.statSync(dbPath);
        const bunStat = fs.statSync(bundledDbPath);
        if (curStat.size < bunStat.size * 0.8) {
          targetPath = bundledDbPath;
        }
      } catch (e) {}
    }
  }

  if (fs.existsSync(targetPath)) {
    try {
      let raw = fs.readFileSync(targetPath, 'utf8');
      if (raw.charCodeAt(0) === 0xFEFF) {
        raw = raw.slice(1);
      }
      const parsed = JSON.parse(raw);
      if (parsed.dbData) {
        for (let key in dbData) delete dbData[key];
        Object.assign(dbData, parsed.dbData);
      }
      if (parsed.idTrackers) {
        for (let key in idTrackers) delete idTrackers[key];
        Object.assign(idTrackers, parsed.idTrackers);
      }
      isDbLoaded = true;

      // Ensure dynamic tables are initialized
      dbData.users = dbData.users || [];
      dbData.orders = dbData.orders || [];
      dbData.user_tasks = dbData.user_tasks || [];
      dbData.transactions = dbData.transactions || [];
      dbData.products = dbData.products || [];
      dbData.price_ranges = dbData.price_ranges || [];
      dbData.sliders = dbData.sliders || [];
      dbData.bank_accounts = dbData.bank_accounts || [];
      dbData.messages = dbData.messages || [];
      dbData.withdrawals = dbData.withdrawals || [];
      dbData.disputes = dbData.disputes || [];
      dbData.settings = dbData.settings || {
        level1_commission: 10,
        level2_commission: 5,
        level3_commission: 2,
        telegram_link: "https://t.me/Gopay",
        winpey_api_key: "488b923c-2b03-465e-b9df-55d018124e0c",
        winpey_api_secret: "fc4a56a2439f47c19213c747ee5693c6"
      };
      if (dbData.settings.telegram_link === undefined) dbData.settings.telegram_link = "https://t.me/Gopay";
      if (!dbData.settings.winpey_api_key) dbData.settings.winpey_api_key = "488b923c-2b03-465e-b9df-55d018124e0c";
      if (!dbData.settings.winpey_api_secret) dbData.settings.winpey_api_secret = "fc4a56a2439f47c19213c747ee5693c6";

      idTrackers.users = idTrackers.users || 0;
      idTrackers.orders = idTrackers.orders || 0;
      idTrackers.user_tasks = idTrackers.user_tasks || 0;
      idTrackers.transactions = idTrackers.transactions || 0;
      idTrackers.products = idTrackers.products || 0;
      idTrackers.price_ranges = idTrackers.price_ranges || 0;
      idTrackers.sliders = idTrackers.sliders || 0;
      idTrackers.bank_accounts = idTrackers.bank_accounts || 0;
      idTrackers.messages = idTrackers.messages || 0;
      idTrackers.withdrawals = idTrackers.withdrawals || 0;
      idTrackers.disputes = idTrackers.disputes || 0;

      // Migrate existing upi_accounts to bank_accounts
      if (dbData.upi_accounts) {
        dbData.bank_accounts = dbData.upi_accounts.map(acc => ({
          id: acc.id,
          user_id: acc.user_id,
          bank_name: acc.wallet_type || 'HDFC Bank',
          account_holder: 'Tushar Sharma',
          account_number: acc.upi_id ? acc.upi_id.split('@')[0] : '50100481729381',
          ifsc_code: 'HDFC0000123',
          status: acc.status,
          created_at: acc.created_at || new Date().toISOString()
        }));
        idTrackers.bank_accounts = Math.max(idTrackers.upi_accounts || 0, dbData.bank_accounts.length);
        delete dbData.upi_accounts;
        delete idTrackers.upi_accounts;
        saveDb();
      }

      // Migrate existing user records to include username and is_blocked properties
      let migrated = false;
      dbData.users.forEach(u => {
        if (!u.username) {
          if (u.uid === 'M118248') {
            u.username = 'Bee_dg9mz6bc';
          } else {
            u.username = `Gopay_${u.uid}`;
          }
          migrated = true;
        }
        if (u.is_blocked === undefined) {
          u.is_blocked = false;
          migrated = true;
        }
      });
      if (migrated) {
        saveDb();
      }
      repairMissingCommissions();
      repairWalletBalancesForOrders23And24();
      repairHistoryDepositSplits();
      repairWithdrawalTransactionTypes();

      // Retroactively repair negative balances by removing the negative sign (making them positive)
      let fixedBalancesCount = 0;
      dbData.users.forEach(u => {
        if (u.bcoin_balance < 0) {
          const original = u.bcoin_balance;
          u.bcoin_balance = Math.abs(u.bcoin_balance);
          console.log(`[Repair] Converted negative T-Coin balance for user ${u.username} (UID: ${u.uid}) from ${original} to ${u.bcoin_balance}`);
          fixedBalancesCount++;
        }
      });
      if (fixedBalancesCount > 0) {
        saveDb();
      }
      isDbLoaded = true;
    } catch (e) {
      console.error('Error loading JSON database:', e);
    }
  }
}

// Main query simulator
const query = {
  get: async (sql, params = []) => {
    try {
      const { isMysqlConnected, queryMysql } = require('./mysql');
      if (isMysqlConnected()) {
        const rows = await queryMysql(sql, params);
        if (Array.isArray(rows)) {
          return rows.length > 0 ? rows[0] : null;
        }
        return rows || null;
      }
    } catch (err) {
      console.warn('[MySQL query.get fallback]:', err.message);
    }
    loadDb();
    const cleanSql = sql.replace(/\s+/g, ' ').trim();

    // 1. SELECT COUNT(*) as count FROM users
    if (cleanSql.includes('SELECT COUNT(*) as count FROM users')) {
      return { count: dbData.users.length };
    }

    // 2. SELECT id FROM users WHERE uid = ?
    if (cleanSql.startsWith('SELECT id FROM users WHERE uid = ?')) {
      let user = dbData.users.find(u => u.uid === params[0]);
      if (!user) {
        try {
          const { isMysqlConnected, fetchOneFromMysql, fetchAllFromMysql, persistToMysql } = require('./mysql');
          if (isMysqlConnected()) {
    const data = await fetchOneFromMysql('users', 'uid', params[0]);
    if (data) user = data;
  }
        } catch (e) {}
      }
      return user ? { id: user.id } : null;
    }

    // 3. SELECT id FROM users WHERE ref_code = ?
    if (cleanSql.startsWith('SELECT id FROM users WHERE ref_code = ?')) {
      let user = dbData.users.find(u => u.ref_code === params[0]);
      if (!user) {
        try {
          const { isMysqlConnected, fetchOneFromMysql, fetchAllFromMysql, persistToMysql } = require('./mysql');
          if (isMysqlConnected()) {
    const data = await fetchOneFromMysql('users', 'ref_code', params[0]);
    if (data) user = data;
  }
        } catch (e) {}
      }
      return user ? { id: user.id } : null;
    }

    // 4. SELECT * FROM users WHERE mobile = ?
    if (cleanSql.includes('FROM users WHERE mobile = ?')) {
      let user = dbData.users.find(u => u.mobile === params[0]);
      if (!user) {
        try {
          const { isMysqlConnected, fetchOneFromMysql, fetchAllFromMysql, persistToMysql } = require('./mysql');
          if (isMysqlConnected()) {
    const data = await fetchOneFromMysql('users', 'mobile', params[0]);
    if (data) { user = data; dbData.users.push(data); }
  }
        } catch (e) {}
      }
      return user ? { ...user } : null;
    }

    // 5. SELECT * FROM users WHERE id = ?
    if (cleanSql.startsWith('SELECT * FROM users WHERE id = ?') || cleanSql.includes('FROM users WHERE id = ?')) {
      let user = dbData.users.find(u => u.id == params[0]);
      if (!user) {
        try {
          const { isMysqlConnected, fetchOneFromMysql, fetchAllFromMysql, persistToMysql } = require('./mysql');
          if (isMysqlConnected()) {
    const data = await fetchOneFromMysql('users', 'id', params[0]);
    if (data) { user = data; dbData.users.push(data); }
  }
        } catch (e) {}
      }
      return user ? { ...user } : null;
    }

    // 6. SELECT completed, claimed FROM user_tasks WHERE user_id = ? AND task_key = ?
    if (cleanSql.startsWith('SELECT completed, claimed FROM user_tasks WHERE user_id = ? AND task_key = ?') ||
        cleanSql.startsWith('SELECT completed, claimed FROM user_tasks WHERE user_id = ? AND task_key = "set_pin"')) {
      dbData.user_tasks = dbData.user_tasks || [];
      const key = params[1] || 'set_pin';
      const task = dbData.user_tasks.find(t => t.user_id == params[0] && t.task_key === key);
      return task ? { completed: task.completed, claimed: task.claimed } : null;
    }

    // 7. SELECT completed FROM user_tasks WHERE user_id = ? AND task_key = ?
    if (cleanSql.startsWith('SELECT completed FROM user_tasks WHERE user_id = ? AND task_key = ?')) {
      dbData.user_tasks = dbData.user_tasks || [];
      const task = dbData.user_tasks.find(t => t.user_id == params[0] && t.task_key === params[1]);
      return task ? { completed: task.completed } : null;
    }

    // 8. SELECT id FROM transactions WHERE user_id = ? AND type = "Newbie Bonus" AND amount = 60.0
    if (cleanSql.includes('SELECT id FROM transactions WHERE user_id = ? AND type = "Newbie Bonus" AND amount = 60.0')) {
      const txn = dbData.transactions.find(t => t.user_id == params[0] && t.type === 'Newbie Bonus' && t.amount === 60.0);
      return txn ? { id: txn.id } : null;
    }

    // 9. SELECT COUNT(*) as count FROM bank_accounts WHERE user_id = ?
    if (cleanSql.includes('SELECT COUNT(*) as count FROM bank_accounts WHERE user_id = ?')) {
      const count = dbData.bank_accounts.filter(a => a.user_id == params[0]).length;
      return { count };
    }

    // 10. SELECT * FROM bank_accounts WHERE id = ? AND user_id = ?
    if (cleanSql.startsWith('SELECT * FROM bank_accounts WHERE id = ? AND user_id = ?')) {
      const acc = dbData.bank_accounts.find(a => a.id === parseInt(params[0]) && a.user_id == params[1]);
      return acc ? { ...acc } : null;
    }

    // 10b. SELECT * FROM bank_accounts WHERE user_id = ? AND status = "Active" LIMIT 1
    if (cleanSql.includes('FROM bank_accounts WHERE user_id = ?')) {
      let accounts = dbData.bank_accounts.filter(a => a.user_id == params[0]);
      if (cleanSql.includes('status = "Active"') || cleanSql.includes("status = 'Active'")) {
        accounts = accounts.filter(a => a.status === 'Active');
      }
      return accounts.length > 0 ? { ...accounts[0] } : null;
    }

    // 11. SELECT * FROM bank_accounts WHERE id = ?
    if (cleanSql.startsWith('SELECT * FROM bank_accounts WHERE id = ?')) {
      const acc = dbData.bank_accounts.find(a => a.id === parseInt(params[0]));
      return acc ? { ...acc } : null;
    }

    // 12. SELECT * FROM settings LIMIT 1
    if (cleanSql.includes('FROM settings')) {
      try {
        const { isMysqlConnected, fetchOneFromMysql, fetchAllFromMysql, persistToMysql } = require('./mysql');
        if (isMysqlConnected()) {
          const data = await fetchOneFromMysql('settings', 'key', 'config');
          if (data && data.value) {
            dbData.settings = { ...(dbData.settings || {}), ...(typeof data.value === 'string' ? JSON.parse(data.value) : data.value) };
          }
        }
      } catch (_) {}
      dbData.settings = dbData.settings || { level1_commission: 10, level2_commission: 5, level3_commission: 2 };
      if (dbData.settings.payment_mode === undefined) dbData.settings.payment_mode = "gateway";
      if (dbData.settings.upi_ids === undefined) dbData.settings.upi_ids = "";
      return { ...dbData.settings };
    }

    // 12. SELECT * FROM orders WHERE order_id = ?
    if (cleanSql.startsWith('SELECT * FROM orders WHERE order_id = ?')) {
      let ord = dbData.orders.find(o => o.order_id === params[0]);
      if (!ord) {
        try {
          const { isMysqlConnected, fetchOneFromMysql, fetchAllFromMysql, persistToMysql } = require('./mysql');
          if (isMysqlConnected()) {
            const data = await fetchOneFromMysql('orders', 'order_id', params[0]);
            if (data) { ord = data; dbData.orders.push(data); }
          }
        } catch (e) {}
      }
      return ord ? { ...ord } : null;
    }

    // 13. SELECT COUNT(*) as count / cnt FROM orders WHERE user_id = ? ...
    if (cleanSql.includes('SELECT COUNT(*) as cnt FROM orders WHERE user_id = ?') || cleanSql.includes('SELECT COUNT(*) as count FROM orders WHERE user_id = ?')) {
      let filtered = (dbData.orders || []).filter(o => o.user_id == params[0]);
      if (cleanSql.includes("status = 'Completed'") || cleanSql.includes('status = "Completed"')) {
        filtered = filtered.filter(o => o.status === 'Completed');
      }
      if (cleanSql.includes('amount >= ? AND amount <= ?') && params.length >= 3) {
        filtered = filtered.filter(o => Number(o.amount) >= Number(params[1]) && Number(o.amount) <= Number(params[2]));
      }
      return { count: filtered.length, cnt: filtered.length };
    }

    // 13b. SELECT COUNT(*) as count FROM orders WHERE status = ? / "Status"
    if (cleanSql.includes('SELECT COUNT(*) as count FROM orders WHERE status =')) {
      let status = '';
      if (cleanSql.includes('"Confirming"') || cleanSql.includes("'Confirming'")) status = 'Confirming';
      else if (cleanSql.includes('"Completed"') || cleanSql.includes("'Completed'")) status = 'Completed';
      else if (cleanSql.includes('"Canceled"') || cleanSql.includes("'Canceled'")) status = 'Canceled';
      else status = params[0];

      const count = dbData.orders.filter(o => o.status === status).length;
      return { count };
    }

    // 13c. SELECT SUM(amount) as sum FROM orders WHERE status = 'Completed'
    if (cleanSql.includes('SELECT SUM(amount) as sum FROM orders WHERE status =') && cleanSql.includes('Completed')) {
      const sum = dbData.orders.filter(o => o.status === 'Completed').reduce((acc, curr) => acc + curr.amount, 0);
      return { sum };
    }

    // 14. SELECT SUM(amount) as sum FROM transactions WHERE user_id = ? AND type = "Commission"
    if (cleanSql.includes('SELECT SUM(amount) as sum FROM transactions WHERE user_id = ? AND type = "Commission"')) {
      let filtered = dbData.transactions.filter(t => t.user_id == params[0] && t.type === 'Commission');
      
      if (params[1]) {
        // description LIKE ?
        const likeTerm = params[1].replace(/%/g, '');
        filtered = filtered.filter(t => t.description.includes(likeTerm));
      } else if (cleanSql.includes('LIKE "%Level 1%"')) {
        filtered = filtered.filter(t => t.description.includes('Level 1'));
      } else if (cleanSql.includes('LIKE "%Level 2%"')) {
        filtered = filtered.filter(t => t.description.includes('Level 2'));
      } else if (cleanSql.includes('LIKE "%Level 3%"')) {
        filtered = filtered.filter(t => t.description.includes('Level 3'));
      }
      
      const sum = filtered.reduce((acc, curr) => acc + curr.amount, 0);
      return { sum };
    }

    // 14b. SELECT SUM(amount) as sum FROM transactions WHERE user_id = ? AND type = "Withdraw" AND amount < 0
    if (cleanSql.includes('SELECT SUM(amount) as sum FROM transactions WHERE user_id = ? AND type = "Withdraw"')) {
      const sum = dbData.transactions
        .filter(t => t.user_id == params[0] && t.type === 'Withdraw' && t.amount < 0)
        .reduce((acc, curr) => acc + curr.amount, 0);
      return { sum };
    }

    // 14c. SELECT SUM(amount) as total FROM orders WHERE user_id = ? AND status = "Completed"
    if (cleanSql.includes('SELECT SUM(amount) as total FROM orders WHERE user_id = ?')) {
      const sum = dbData.orders
        .filter(o => o.user_id == params[0] && o.status === 'Completed')
        .reduce((acc, curr) => acc + curr.amount, 0);
      return { total: sum };
    }

    // 14d. SELECT * FROM withdrawals WHERE id = ?
    if (cleanSql.includes('FROM withdrawals WHERE id = ?')) {
      let w = (dbData.withdrawals || []).find(x => x.id == params[0]);
      if (!w) {
        try {
          const { isMysqlConnected, fetchOneFromMysql } = require('./mysql');
          if (isMysqlConnected()) {
            const data = await fetchOneFromMysql('withdrawals', 'id', params[0]);
            if (data) w = data;
          }
        } catch (e) {}
      }
      return w ? { ...w } : null;
    }

    console.warn('Simulated query.get returned default null for:', cleanSql);
    return null;
  },

  all: async (sql, params = []) => {
    try {
      const { isMysqlConnected, queryMysql } = require('./mysql');
      if (isMysqlConnected()) {
        const rows = await queryMysql(sql, params);
        return Array.isArray(rows) ? rows : [];
      }
    } catch (err) {
      console.warn('[MySQL query.all fallback]:', err.message);
    }
    loadDb();
    const cleanSql = sql.replace(/\s+/g, ' ').trim();

    // 0. SELECT FROM withdrawals
    if (cleanSql.includes('FROM withdrawals')) {
      if (cleanSql.includes('user_id = ?')) {
        const uId = params[0];
        try {
          const { isMysqlConnected, fetchOneFromMysql, fetchAllFromMysql, persistToMysql } = require('./mysql');
          if (isMysqlConnected()) {
            const suW = await fetchWhereFromMysql('withdrawals', 'user_id', uId);
            if (suW && suW.length > 0) return suW;
          }
        } catch (e) {}
      }
      let list = [...(dbData.withdrawals || [])];
      if (cleanSql.includes('user_id = ?')) {
        list = list.filter(w => w.user_id == params[0]);
      }
      if (cleanSql.includes('status = ?')) {
        const targetStatus = params.length > 1 ? params[1] : params[0];
        list = list.filter(w => w.status === targetStatus);
      }
      if (cleanSql.includes('DESC') || cleanSql.includes('desc') || cleanSql.includes('ORDER BY')) {
        list.sort((a, b) => (b.id || 0) - (a.id || 0));
      }
      return list;
    }

    // 1. SELECT task_key, completed, claimed FROM user_tasks WHERE user_id = ?
    if (cleanSql.startsWith('SELECT task_key, completed, claimed FROM user_tasks WHERE user_id = ?')) {
      dbData.user_tasks = dbData.user_tasks || [];
      return dbData.user_tasks
        .filter(t => t.user_id == params[0])
        .map(t => ({ task_key: t.task_key, completed: t.completed, claimed: t.claimed }));
    }

    // 2. SELECT * FROM bank_accounts WHERE user_id = ? ORDER BY id DESC
    if (cleanSql.startsWith('SELECT * FROM bank_accounts WHERE user_id = ?')) {
      const accounts = dbData.bank_accounts.filter(a => a.user_id == params[0]);
      return [...accounts].sort((a, b) => (b.id || 0) - (a.id || 0));
    }

    // 2b. SELECT * FROM bank_accounts
    if (cleanSql.includes('FROM bank_accounts') && !cleanSql.includes('WHERE user_id = ?')) {
      let list = dbData.bank_accounts || [];
      if (cleanSql.includes('status = "Active"') || cleanSql.includes("status = 'Active'")) {
        list = list.filter(a => a.status === 'Active');
      }
      return [...list].sort((a, b) => (b.id || 0) - (a.id || 0));
    }

    // 3. SELECT FROM orders (all variants: by user_id, by status, enriched, etc.)
    if (cleanSql.includes('FROM orders')) {
      if (cleanSql.includes('user_id = ?')) {
        const uId = params[0];
        try {
          const { isMysqlConnected, fetchOneFromMysql, fetchAllFromMysql, persistToMysql } = require('./mysql');
          if (isMysqlConnected()) {
            const suOrders = await fetchWhereFromMysql('orders', 'user_id', uId);
            if (suOrders && suOrders.length > 0) return suOrders;
          }
        } catch (e) {}
      } else {
        try {
          const { isMysqlConnected, fetchOneFromMysql, fetchAllFromMysql, persistToMysql } = require('./mysql');
          if (isMysqlConnected()) {
            const suRecent = await fetchAllFromMysql('orders', 200);
            if (suRecent && suRecent.length > 0) return suRecent;
          }
        } catch (e) {}
      }

      let ords = [...(dbData.orders || [])];
      if (cleanSql.includes('user_id = ?')) {
        ords = ords.filter(o => o.user_id == params[0]);
      }
      if (cleanSql.includes('status = "Completed"') || cleanSql.includes("status = 'Completed'")) {
        ords = ords.filter(o => o.status === 'Completed');
      } else if (cleanSql.includes('status = "Confirming"') || cleanSql.includes("status = 'Confirming'")) {
        ords = ords.filter(o => o.status === 'Confirming');
      } else if (cleanSql.includes('status = "Canceled"') || cleanSql.includes("status = 'Canceled'")) {
        ords = ords.filter(o => o.status === 'Canceled');
      }
      if (cleanSql.includes('users.uid as user_uid') || cleanSql.includes('LEFT JOIN users')) {
        ords = ords.map(o => {
          const user = (dbData.users || []).find(u => u.id === o.user_id) || {};
          return {
            ...o,
            user_uid: user.uid || '',
            user_mobile: user.mobile || ''
          };
        });
      }
      if (cleanSql.includes('ORDER BY') && (cleanSql.includes('DESC') || cleanSql.includes('desc'))) {
        return ords.sort((a, b) => (b.id || 0) - (a.id || 0));
      }
      return ords;
    }

    // 4. SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC
    if (cleanSql.startsWith('SELECT * FROM transactions WHERE user_id = ?')) {
      const uId = params[0];
      try {
        const { isMysqlConnected, fetchOneFromMysql, fetchAllFromMysql, persistToMysql } = require('./mysql');
        if (isMysqlConnected()) {
          const suTxns = await fetchWhereFromMysql('transactions', 'user_id', uId);
          if (suTxns && suTxns.length > 0) return suTxns;
        }
      } catch (e) {}
      let txs = dbData.transactions.filter(t => t.user_id == uId);
      if (cleanSql.includes('type = "Withdraw"') || cleanSql.includes("type = 'Withdraw'")) {
        txs = txs.filter(t => t.type === 'Withdraw');
      }
      return txs.sort((a, b) => (b.id || 0) - (a.id || 0));
    }

    // 4b. SELECT FROM transactions
    if (cleanSql.includes('FROM transactions') && !cleanSql.includes('WHERE user_id = ?')) {
      let list = dbData.transactions || [];
      if (cleanSql.includes('type = "Withdraw"') || cleanSql.includes("type = 'Withdraw'")) {
        list = list.filter(t => t.type === 'Withdraw');
      }
      return [...list].sort((a, b) => (b.id || 0) - (a.id || 0));
    }

    // 5. SELECT id, uid, mobile, created_at FROM users WHERE parent_id = ?
    if (cleanSql.startsWith('SELECT id, uid, mobile, created_at FROM users WHERE parent_id = ?')) {
      return dbData.users
        .filter(u => u.parent_id == params[0])
        .map(u => ({ id: u.id, uid: u.uid, mobile: u.mobile, created_at: u.created_at }));
    }

    // 6. SELECT id, uid, mobile, created_at FROM users WHERE parent_id IN (...)
    if (cleanSql.includes('WHERE parent_id IN')) {
      const match = cleanSql.match(/IN \(([^)]+)\)/);
      let ids = [];
      if (match) {
        ids = match[1].split(',').map(id => parseInt(id.trim()));
      }
      return dbData.users
        .filter(u => ids.includes(u.parent_id))
        .map(u => ({ id: u.id, uid: u.uid, mobile: u.mobile, created_at: u.created_at }));
    }

    // 8. SELECT id, uid, mobile, inr_balance, bcoin_balance, total_earnings, today_profit, created_at FROM users ORDER BY id DESC
    if (cleanSql.includes('FROM users ORDER BY id DESC') || cleanSql.includes('FROM users ORDER BY id desc')) {
      try {
        const { isMysqlConnected, fetchOneFromMysql, fetchAllFromMysql, persistToMysql } = require('./mysql');
        if (isMysqlConnected()) {
          const suRecentUsers = await fetchAllFromMysql('users', 300);
          if (suRecentUsers && suRecentUsers.length > 0) return suRecentUsers;
        }
      } catch (e) {}
      const mapped = dbData.users.map(u => ({
        id: u.id,
        uid: u.uid,
        username: u.username || `Gopay_${u.uid}`,
        mobile: u.mobile,
        inr_balance: Number(u.inr_balance) || 0,
        bcoin_balance: Number(u.bcoin_balance) || 0,
        total_earnings: Number(u.total_earnings) || 0,
        today_profit: Number(u.today_profit) || 0,
        is_blocked: Boolean(u.is_blocked),
        created_at: u.created_at
      }));
      return mapped.sort((a, b) => (b.id || 0) - (a.id || 0));
    }

    // 9. SELECT * FROM sliders ORDER BY id DESC
    if (cleanSql.includes('FROM sliders') || cleanSql.includes('SELECT * FROM sliders')) {
      dbData.sliders = dbData.sliders || [];
      return [...dbData.sliders].reverse();
    }

    // 10. SELECT * FROM products
    if (cleanSql.includes('FROM products') || cleanSql.includes('SELECT * FROM products')) {
      dbData.products = dbData.products || [];
      return [...dbData.products];
    }

    // 11. SELECT * FROM price_ranges
    if (cleanSql.includes('FROM price_ranges') || cleanSql.includes('SELECT * FROM price_ranges')) {
      dbData.price_ranges = dbData.price_ranges || [];
      return [...dbData.price_ranges];
    }

    // 12. SELECT * FROM messages ORDER BY id DESC
    if (cleanSql.includes('FROM messages') || cleanSql.includes('SELECT * FROM messages')) {
      dbData.messages = dbData.messages || [];
      return [...dbData.messages].reverse();
    }

    console.warn('Simulated query.all returned default [] for:', cleanSql);
    return [];
  },

  run: async (sql, params = []) => {
    try {
      const { isMysqlConnected, queryMysql } = require('./mysql');
      if (isMysqlConnected()) {
        const res = await queryMysql(sql, params);
        return {
          changes: res ? (res.affectedRows || 0) : 0,
          lastInsertRowid: res ? (res.insertId || 0) : 0
        };
      }
    } catch (err) {
      console.warn('[MySQL query.run fallback]:', err.message);
    }
    loadDb();
    const cleanSql = sql.replace(/\s+/g, ' ').trim();

    // --- INSERT STATEMENTS ---
    if (cleanSql.startsWith('INSERT INTO') || cleanSql.startsWith('INSERT OR IGNORE INTO')) {
      let table = '';
      if (cleanSql.includes('INTO users')) table = 'users';
      else if (cleanSql.includes('INTO orders')) table = 'orders';
      else if (cleanSql.includes('INTO bank_accounts')) table = 'bank_accounts';
      else if (cleanSql.includes('INTO transactions')) table = 'transactions';
      else if (cleanSql.includes('INTO user_tasks')) table = 'user_tasks';
      else if (cleanSql.includes('INTO sliders')) table = 'sliders';
      else if (cleanSql.includes('INTO products')) table = 'products';
      else if (cleanSql.includes('INTO price_ranges')) table = 'price_ranges';
      else if (cleanSql.includes('INTO messages')) table = 'messages';
      else if (cleanSql.includes('INTO withdrawals')) table = 'withdrawals';

      if (table) {
        idTrackers[table]++;
        const newId = idTrackers[table];
        let record = { id: newId, created_at: new Date().toISOString() };

        if (table === 'users') {
          idTrackers.users++;
          const newUserId = idTrackers.users;

          if (params.length === 11) {
            record = {
              id: newUserId,
              created_at: new Date().toISOString(),
              uid: params[0],
              mobile: params[1],
              username: `Gopay_${params[0]}`,
              password_hash: params[2],
              pin: params[3],
              ref_code: params[4],
              parent_id: params[5],
              inr_balance: params[6],
              bcoin_balance: params[7],
              usdt_balance: 0.0,
              total_earnings: params[8],
              today_profit: params[9],
              yesterday_profit: params[10],
              is_blocked: false,
              fcm_tokens: []
            };
          } else {
            record = {
              id: newUserId,
              created_at: new Date().toISOString(),
              uid: params[0],
              mobile: params[1],
              username: `Gopay_${params[0]}`,
              password_hash: params[2],
              pin: null,
              ref_code: params[3],
              parent_id: params[4],
              inr_balance: 0.0,
              bcoin_balance: 0.0,
              usdt_balance: 0.0,
              total_earnings: 0.0,
              today_profit: 0.0,
              yesterday_profit: 0.0,
              is_blocked: false,
              fcm_tokens: []
            };
          }
        } 
        else if (table === 'orders') {


            
          idTrackers.orders++;
          const newOrderId = idTrackers.orders;
          record = {
            id: newOrderId,
            created_at: new Date().toISOString(),
            order_id: params[0],
            user_id: params[1],
            asset_type: params[2],
            amount: params[3],
            expected_income: params[4],
            quota: params[5],
            status: params[6] || 'Confirming',
            utr: params.length === 8 ? params[7] : null
          };
        }
        else if (table === 'bank_accounts') {
          if (params.length === 6) {
            record = {
              ...record,
              user_id: params[0],
              bank_name: params[1],
              account_holder: params[2],
              account_number: params[3],
              ifsc_code: params[4],
              upi_id: params[5],
              status: 'Active'
            };
          } else {
            record = {
              ...record,
              user_id: params[0],
              bank_name: params[1],
              account_holder: params[2],
              account_number: params[3],
              ifsc_code: params[4],
              status: params[5] || 'Active'
            };
          }
        }
        else if (table === 'transactions') {


            
          idTrackers.transactions++;
          record.id = idTrackers.transactions;

          // Check if params are shifted (when type is hardcoded in SQL: VALUES (?, 'Deposit/Commission/Withdraw', ?, ?, ?))
          if (params.length === 4) {
            let inferredType = 'Commission';
            if (cleanSql.includes("'Deposit'")) {
              inferredType = 'Deposit';
            } else if (cleanSql.includes("'Withdraw'")) {
              inferredType = 'Withdraw';
            } else if (cleanSql.includes("'Task Reward'")) {
              inferredType = 'Task Reward';
            }
            
            record = {
              ...record,
              user_id: params[0],
              type: inferredType,
              amount: params[1],
              balance_after: params[2],
              description: params[3]
            };
          } else {
            record = {
              ...record,
              user_id: params[0],
              type: params[1],
              amount: params[2],
              balance_after: params[3],
              description: params[4]
            };
          }
        }
        else if (table === 'user_tasks') {
          dbData.user_tasks = dbData.user_tasks || [];
          if (cleanSql.includes("'set_pin'") || cleanSql.includes("'add_support'")) {
            const keys = ['set_pin', 'add_support', 'join_bot'];
            for (const key of keys) {
              const exists = dbData.user_tasks.find(t => t.user_id === params[0] && t.task_key === key);
              if (!exists) {
                idTrackers.user_tasks = (idTrackers.user_tasks || 0) + 1;
                dbData.user_tasks.push({
                  id: idTrackers.user_tasks,
                  user_id: params[0],
                  task_key: key,
                  completed: 0,
                  claimed: 0,
                  created_at: new Date().toISOString()
                });
              }
            }
            saveDb();
            return { changes: 3 };
          }

          const targetUserId = params[0];
          const targetTaskKey = params[1];
          const exists = dbData.user_tasks.find(t => t.user_id === targetUserId && t.task_key === targetTaskKey);
          if (exists) {
            return { lastID: exists.id, changes: 0 };
          }
          record = {
            ...record,
            user_id: targetUserId,
            task_key: targetTaskKey,
            completed: params[2] || 0,
            claimed: params[3] || 0
          };
        }
        else if (table === 'sliders') {
          // INSERT INTO sliders (image_data) VALUES (?)
          record = {
            ...record,
            image_data: params[0]
          };
        }
        else if (table === 'products') {
          // INSERT INTO products (name, amount, income, quota, color, type, percent)
          record = {
            ...record,
            name: params[0],
            amount: Number(params[1]),
            income: Number(params[2]),
            quota: Number(params[3]),
            color: params[4],
            type: params[5],
            percent: params[6]
          };
        }
        else if (table === 'price_ranges') {
          // INSERT INTO price_ranges (label, min_val, max_val)
          record = {
            ...record,
            label: params[0],
            min_val: Number(params[1]),
            max_val: Number(params[2])
          };
        }
        else if (table === 'messages') {
          // INSERT INTO messages (title, content)
          record = {
            ...record,
            title: params[0],
            content: params[1]
          };
        }
        else if (table === 'withdrawals') {
          record = {
            ...record,
            user_id: params[0],
            amount: Number(params[1]),
            amount_pending: params[2] !== undefined ? Number(params[2]) : Number(params[1]),
            status: params[3] || 'Pending',
            bank_account_id: params[4] || null,
            utr: params[5] || null,
            txid: params[6] || null
          };
        }

        dbData[table].push(record);
        saveDb();
        await persistToDb(table, record, 'upsert', table === 'orders' ? 'order_id' : 'id');
        return { lastID: record.id || newId, changes: 1 };
      }
    }

    // --- UPDATE STATEMENTS ---
    if (cleanSql.startsWith('UPDATE')) {
      let changes = 0;
      
      // 0. UPDATE users SET is_blocked = ? WHERE id = ?
      if (cleanSql.includes('UPDATE users SET is_blocked = ? WHERE id = ?')) {
        const user = dbData.users.find(u => u.id == params[1]);
        if (user) {
          user.is_blocked = Boolean(params[0]);
          changes = 1;
          saveDb();
          await persistToDb('users', user, 'update', 'id');
        }
      }

      // 1. UPDATE users SET password_hash = ? WHERE id = ?
      else if (cleanSql.includes('UPDATE users SET password_hash = ? WHERE id = ?')) {
        const user = dbData.users.find(u => u.id == params[1]);
        if (user) {
          user.password_hash = params[0];
          changes = 1;
          saveDb();
          await persistToDb('users', user, 'update', 'id');
        }
      }
      // 1b. UPDATE users SET bcoin_balance = ? WHERE id = ?
      else if (cleanSql.includes('UPDATE users SET bcoin_balance = ? WHERE id = ?')) {
        const user = dbData.users.find(u => u.id == params[1]);
        if (user) {
          user.bcoin_balance = Number(params[0]);
          changes = 1;
          saveDb();
          await persistToDb('users', user, 'update', 'id');
        }
      }
      
      // 2. UPDATE users SET pin = ? WHERE id = ?
      else if (cleanSql.includes('UPDATE users SET pin = ? WHERE id = ?')) {
        const user = dbData.users.find(u => u.id == params[1]);
        if (user) {
          user.pin = params[0];
          changes = 1;
          saveDb();
          await persistToDb('users', user, 'update', 'id');
        }
      }

      // 3. UPDATE user_tasks SET completed = 1 WHERE user_id = ? AND task_key = ?
      else if (cleanSql.includes('UPDATE user_tasks SET completed = 1')) {
        const task = dbData.user_tasks.find(t => t.user_id == params[0] && t.task_key === params[1]);
        if (task) {
          task.completed = 1;
          task.updated_at = new Date().toISOString();
          changes = 1;
          saveDb();
        }
      }

      // 4. UPDATE users SET bcoin_balance = bcoin_balance + 20 WHERE id = ?
      else if (cleanSql.includes('UPDATE users SET bcoin_balance = bcoin_balance + 20 WHERE id = ?')) {
        const user = dbData.users.find(u => u.id == params[0]);
        if (user) {
          user.bcoin_balance += 20;
          changes = 1;
          saveDb();
          await persistToDb('users', user, 'update', 'id');
        }
      }

      // 5. UPDATE users SET inr_balance = inr_balance + 60 WHERE id = ?
      else if (cleanSql.includes('UPDATE users SET inr_balance = inr_balance + 60 WHERE id = ?')) {
        const user = dbData.users.find(u => u.id == params[0]);
        if (user) {
          user.inr_balance += 60;
          changes = 1;
          saveDb();
          await persistToDb('users', user, 'update', 'id');
        }
      }

      // 5b. UPDATE users SET username = ? WHERE id = ?
      else if (cleanSql.includes('UPDATE users SET username = ? WHERE id = ?')) {
        const user = dbData.users.find(u => u.id == params[1]);
        if (user) {
          user.username = params[0];
          changes = 1;
          saveDb();
          await persistToDb('users', user, 'update', 'id');
        }
      }

      // 6. UPDATE user_tasks SET claimed = 1 WHERE user_id = ? AND task_key IN (...)
      else if (cleanSql.includes('UPDATE user_tasks SET claimed = 1 WHERE user_id = ?')) {
        dbData.user_tasks
          .filter(t => t.user_id == params[0] && ['set_pin', 'add_support', 'join_bot'].includes(t.task_key))
          .forEach(t => {
            t.claimed = 1;
            changes++;
          });
        saveDb();
      }

      // 7. UPDATE bank_accounts SET status = ? WHERE id = ?
      else if (cleanSql.includes('UPDATE bank_accounts SET status = ? WHERE id = ?')) {
        const acc = dbData.bank_accounts.find(a => a.id === parseInt(params[1]));
        if (acc) {
          acc.status = params[0];
          changes = 1;
          saveDb();
          await persistToDb('bank_accounts', acc, 'update', 'id');
        }
      }

      // 8. UPDATE settings SET level1_commission = ?, level2_commission = ?, level3_commission = ?
      else if (cleanSql.includes('UPDATE settings SET')) {
        dbData.settings = {
          ...dbData.settings,
          level1_commission: Number(params[0]),
          level2_commission: Number(params[1]),
          level3_commission: Number(params[2]),
          telegram_link: params[3] !== undefined ? params[3] : (dbData.settings.telegram_link || "https://t.me/Gopay"),
          winpey_api_key: params[4] !== undefined ? params[4] : (dbData.settings.winpey_api_key || "488b923c-2b03-465e-b9df-55d018124e0c"),
          winpey_api_secret: params[5] !== undefined ? params[5] : (dbData.settings.winpey_api_secret || "fc4a56a2439f47c19213c747ee5693c6"),
          payment_mode: params[6] !== undefined ? params[6] : (dbData.settings.payment_mode || "gateway"),
          upi_ids: params[7] !== undefined ? params[7] : (dbData.settings.upi_ids || "")
        };
        changes = 1;
        saveDb();
      }

      // 8. UPDATE orders SET status = "Completed"...
      else if (cleanSql.includes('UPDATE orders SET status = "Completed"')) {
        const orderIdParam = params.length > 1 ? params[1] : params[0];
        const utrParam = params.length > 1 ? params[0] : null;
        let ord = dbData.orders.find(o => o.order_id === orderIdParam);
        if (!ord) {
          try {
            const { isMysqlConnected, fetchOneFromMysql, fetchAllFromMysql, persistToMysql } = require('./mysql');
            if (isMysqlConnected()) {
              const data = await fetchOneFromMysql('orders', 'order_id', orderIdParam);
              if (data) { ord = data; dbData.orders.push(data); }
            }
          } catch (e) {}
        }
        if (ord) {
          ord.status = 'Completed';
          if (utrParam) ord.utr = utrParam;
          changes = 1;
          saveDb();
          await persistToDb('orders', ord, 'update', 'order_id');
        }
      }

      // 9. UPDATE orders SET status = "Canceled"...
      else if (cleanSql.includes('UPDATE orders SET status = "Canceled"')) {
        const orderIdParam = params.length > 1 ? params[1] : params[0];
        let ord = dbData.orders.find(o => o.order_id === orderIdParam);
        if (!ord) {
          try {
            const { isMysqlConnected, fetchOneFromMysql, fetchAllFromMysql, persistToMysql } = require('./mysql');
            if (isMysqlConnected()) {
              const data = await fetchOneFromMysql('orders', 'order_id', orderIdParam);
              if (data) { ord = data; dbData.orders.push(data); }
            }
          } catch (e) {}
        }
        if (ord) {
          ord.status = 'Canceled';
          changes = 1;
          saveDb();
          await persistToDb('orders', ord, 'update', 'order_id');
        }
      }

      // 10. UPDATE orders SET utr = ? WHERE order_id = ?
      else if (cleanSql.includes('UPDATE orders SET utr = ? WHERE order_id = ?')) {
        let ord = dbData.orders.find(o => o.order_id === params[1]);
        if (!ord) {
          try {
            const { isMysqlConnected, fetchOneFromMysql, fetchAllFromMysql, persistToMysql } = require('./mysql');
            if (isMysqlConnected()) {
              const data = await fetchOneFromMysql('orders', 'order_id', params[1]);
              if (data) { ord = data; dbData.orders.push(data); }
            }
          } catch (e) {}
        }
        if (ord) {
          ord.utr = params[0];
          changes = 1;
          saveDb();
          await persistToDb('orders', ord, 'update', 'order_id');
        }
      }

      // 11. UPDATE users SET inr_balance = ?, total_earnings = ?, today_profit = ? WHERE id = ?
      else if (cleanSql.includes('UPDATE users SET inr_balance = ?, total_earnings = ?, today_profit = ? WHERE id = ?')) {
        const user = dbData.users.find(u => u.id == params[3]);
        if (user) {
          user.inr_balance = Number(params[0]);
          user.total_earnings = Number(params[1]);
          user.today_profit = Number(params[2]);
          changes = 1;
          saveDb();
          await persistToDb('users', user, 'update', 'id');
        }
      }

      // 11b. UPDATE users SET inr_balance = ?, bcoin_balance = ?, total_earnings = ?, today_profit = ? WHERE id = ?
      else if (cleanSql.includes('UPDATE users SET') && cleanSql.includes('bcoin_balance = ?')) {
        const user = dbData.users.find(u => u.id == params[4]);
        if (user) {
          user.inr_balance = Number(params[0]);
          user.bcoin_balance = Number(params[1]);
          user.total_earnings = Number(params[2]);
          user.today_profit = Number(params[3]);
          changes = 1;
          saveDb();
          await persistToDb('users', user, 'update', 'id');
        }
      }

      // 5. UPDATE products SET name = ?, amount = ?, income = ?, quota = ?, color = ?, type = ?, percent = ? WHERE id = ?
      if (cleanSql.includes('UPDATE products SET name = ?')) {
        const prod = dbData.products.find(p => p.id === parseInt(params[7]));
        if (prod) {
          prod.name = params[0];
          prod.amount = Number(params[1]);
          prod.income = Number(params[2]);
          prod.quota = Number(params[3]);
          prod.color = params[4];
          prod.type = params[5];
          prod.percent = params[6];
          changes = 1;
          saveDb();
          await persistToDb('products', prod, 'update', 'id');
        }
      }

      // 12. UPDATE withdrawals SET amount_pending = amount_pending + ? WHERE id = ?
      else if (cleanSql.includes('UPDATE withdrawals SET amount_pending = amount_pending + ? WHERE id = ?')) {
        const w = dbData.withdrawals.find(x => x.id == params[1]);
        if (w) {
          w.amount_pending = Number(w.amount_pending || 0) + Number(params[0]);
          if (w.amount_pending > 0 && w.status === 'Completed') {
            w.status = 'Pending';
          }
          changes = 1;
          saveDb();
          await persistToDb('withdrawals', w, 'update', 'id');
        }
      }

      // 12b. UPDATE withdrawals SET status = ? WHERE id = ?
      else if (cleanSql.includes('UPDATE withdrawals SET status = ? WHERE id = ?')) {
        const w = dbData.withdrawals.find(x => x.id == params[1]);
        if (w) {
          w.status = params[0];
          changes = 1;
          saveDb();
          await persistToDb('withdrawals', w, 'update', 'id');
        }
      }

      if (changes > 0) {
        return { changes };
      }
    }

    // --- DELETE STATEMENTS ---
    if (cleanSql.startsWith('DELETE FROM')) {
      // 1. DELETE FROM bank_accounts WHERE id = ? AND user_id = ?
      if (cleanSql.includes('DELETE FROM bank_accounts WHERE id = ? AND user_id = ?')) {
        const prevLength = dbData.bank_accounts.length;
        const targetId = parseInt(params[0]);
        dbData.bank_accounts = dbData.bank_accounts.filter(a => !(a.id === targetId && a.user_id === params[1]));
        const changes = prevLength - dbData.bank_accounts.length;
        if (changes > 0) {
          saveDb();
          await persistToDb('bank_accounts', { id: targetId }, 'delete', 'id');
        }
        return { changes };
      }

      // 2. DELETE FROM sliders WHERE id = ?
      if (cleanSql.includes('DELETE FROM sliders WHERE id = ?')) {
        const prevLength = dbData.sliders.length;
        dbData.sliders = dbData.sliders.filter(s => s.id !== parseInt(params[0]));
        const changes = prevLength - dbData.sliders.length;
        if (changes > 0) {
          saveDb();
        }
        return { changes };
      }

      // 3. DELETE FROM products WHERE id = ?
      if (cleanSql.includes('DELETE FROM products WHERE id = ?')) {
        const prevLength = dbData.products.length;
        const targetId = parseInt(params[0]);
        dbData.products = dbData.products.filter(p => p.id !== targetId);
        const changes = prevLength - dbData.products.length;
        if (changes > 0) {
          saveDb();
          await persistToDb('products', { id: targetId }, 'delete', 'id');
        }
        return { changes };
      }

      // 4. DELETE FROM price_ranges WHERE id = ?
      if (cleanSql.includes('DELETE FROM price_ranges WHERE id = ?')) {
        const prevLength = dbData.price_ranges.length;
        dbData.price_ranges = dbData.price_ranges.filter(r => r.id !== parseInt(params[0]));
        const changes = prevLength - dbData.price_ranges.length;
        if (changes > 0) {
          saveDb();
        }
        return { changes };
      }

      // 5. DELETE FROM messages WHERE id = ?
      if (cleanSql.includes('DELETE FROM messages WHERE id = ?')) {
        const prevLength = dbData.messages.length;
        dbData.messages = dbData.messages.filter(m => m.id !== parseInt(params[0]));
        const changes = prevLength - dbData.messages.length;
        if (changes > 0) {
          saveDb();
        }
        return { changes };
      }
    }

    console.warn('Simulated query.run executed no changes for:', cleanSql);
    return { changes: 0 };
  }
};


async function initDb() {
  loadDb();

  // 1. Check & Sync with MySQL (aaPanel Live Server)
  try {
    const { initMysql, isMysqlConnected, fetchAllFromMysql } = require('./mysql');
    const mysqlReady = await initMysql();
    if (mysqlReady && isMysqlConnected()) {
      console.log('[DB] Connecting to MySQL Database as Primary Source of Truth...');
      try {
        const { queryMysql } = require('./mysql');
        const columnsToAdd = [
          'ALTER TABLE `orders` ADD COLUMN `receiver_id` INT DEFAULT NULL',
          'ALTER TABLE `orders` ADD COLUMN `seller_id` INT DEFAULT NULL',
          'ALTER TABLE `orders` ADD COLUMN `receiver_details` TEXT DEFAULT NULL',
          'ALTER TABLE `orders` ADD COLUMN `timer_expiry` DATETIME DEFAULT NULL',
          'ALTER TABLE `orders` ADD COLUMN `screenshot_path` TEXT DEFAULT NULL'
        ];
        for (const sql of columnsToAdd) {
          try { await queryMysql(sql); } catch (_) {}
        }
      } catch (_) {}
      const [myUsers, myOrders, myWithdrawals, myTransactions, myBankAccounts, myProducts, myDisputes] = await Promise.all([
        fetchAllFromMysql('users'),
        fetchAllFromMysql('orders'),
        fetchAllFromMysql('withdrawals'),
        fetchAllFromMysql('transactions'),
        fetchAllFromMysql('bank_accounts'),
        fetchAllFromMysql('products'),
        fetchAllFromMysql('disputes')
      ]);

      if (myUsers && myUsers.length > 0) {
        dbData.users = myUsers;
        idTrackers.users = Math.max(idTrackers.users || 0, ...myUsers.map(u => u.id || 0));
      }
      if (myOrders && myOrders.length > 0) {
        dbData.orders = myOrders;
        idTrackers.orders = Math.max(idTrackers.orders || 0, ...myOrders.map(o => o.id || 0));
      }
      if (myWithdrawals && myWithdrawals.length > 0) {
        dbData.withdrawals = myWithdrawals;
        idTrackers.withdrawals = Math.max(idTrackers.withdrawals || 0, ...myWithdrawals.map(w => w.id || 0));
      }
      if (myTransactions && myTransactions.length > 0) {
        dbData.transactions = myTransactions;
        idTrackers.transactions = Math.max(idTrackers.transactions || 0, ...myTransactions.map(t => t.id || 0));
      }
      if (myBankAccounts && myBankAccounts.length > 0) {
        dbData.bank_accounts = myBankAccounts;
        idTrackers.bank_accounts = Math.max(idTrackers.bank_accounts || 0, ...myBankAccounts.map(b => b.id || 0));
      }
      if (myProducts && myProducts.length > 0) {
        dbData.products = myProducts;
        idTrackers.products = Math.max(idTrackers.products || 0, ...myProducts.map(p => p.id || 0));
      }
      if (myDisputes && myDisputes.length > 0) {
        dbData.disputes = myDisputes;
        idTrackers.disputes = Math.max(idTrackers.disputes || 0, ...myDisputes.map(d => d.id || 0));
      }

      const mySettings = await fetchAllFromMysql('settings');
      if (mySettings && mySettings.length > 0) {
        const configRow = mySettings.find(s => s.key === 'config');
        if (configRow && configRow.value) {
          try {
            dbData.settings = { ...(dbData.settings || {}), ...(typeof configRow.value === 'string' ? JSON.parse(configRow.value) : configRow.value) };
          } catch(e) {}
        }
        const adminRow = mySettings.find(s => s.key === 'admin');
        if (adminRow && adminRow.value) {
          try {
            dbData.admin = { ...(dbData.admin || {}), ...(typeof adminRow.value === 'string' ? JSON.parse(adminRow.value) : adminRow.value) };
          } catch(e) {}
        }
      }

      console.log(`[DB] MySQL connected & synced successfully. (${dbData.users.length} users, ${dbData.orders.length} orders)`);
      return;
    }
  } catch (mErr) {
    console.warn('[DB] MySQL init check skipped:', mErr.message);
  }

  

  // Initialize arrays to prevent runtime errors
  dbData.products = dbData.products || [];
  dbData.price_ranges = dbData.price_ranges || [];
  idTrackers.products = idTrackers.products || 0;
  idTrackers.price_ranges = idTrackers.price_ranges || 0;

  if (dbData.products.length === 0) {
    dbData.products = [
      { id: 1, name: 'HDFC Bank', amount: 10000, income: 1008.0, quota: 11008, color: 'blue', type: 'Bank', percent: '10%+8', created_at: new Date().toISOString() },
      { id: 2, name: 'SBI Bank', amount: 14544, income: 1462.40, quota: 16006.40, color: 'red', type: 'Bank', percent: '10%+8', created_at: new Date().toISOString() }
    ];
    idTrackers.products = 2;
  }

  // Seed default price ranges if empty
  if (dbData.price_ranges.length === 0) {
    dbData.price_ranges = [
      { id: 1, label: 'ALL', min_val: 0, max_val: 99999999, created_at: new Date().toISOString() },
      { id: 2, label: '0 - 500', min_val: 0, max_val: 500, created_at: new Date().toISOString() },
      { id: 3, label: '500 - 1000', min_val: 500, max_val: 1000, created_at: new Date().toISOString() },
      { id: 4, label: '1000 - 5000', min_val: 1000, max_val: 5000, created_at: new Date().toISOString() },
      { id: 5, label: '5000+', min_val: 5000, max_val: 99999999, created_at: new Date().toISOString() }
    ];
    idTrackers.price_ranges = 5;
  }
  
  // Seed default user and relationships if database is empty
  if (dbData.users.length === 0) {
    console.log('[DB] Database is clean and empty.');
  }

  saveDb();
  console.log('Database initialized successfully.');

  // Seed announcements if empty
  dbData.messages = dbData.messages || [];
  idTrackers.messages = idTrackers.messages || 0;
  if (dbData.messages.length === 0) {
    dbData.messages = [
      { id: 1, title: 'Welcome to Gopay!', content: 'Welcome to your premium investment platform. Start exploring daily plans now!', created_at: new Date(Date.now() - 3600000).toISOString() },
      { id: 2, title: 'System Maintenance Scheduled', content: 'Our servers will undergo scheduled optimization on Sunday at 02:00 AM IST. Platforms will remain online.', created_at: new Date().toISOString() }
    ];
    idTrackers.messages = 2;
    saveDb();
  }

  // Repair any orders where UTR was mistakenly saved in status column
  let repairedCount = 0;
  if (dbData.orders && dbData.orders.length > 0) {
    dbData.orders.forEach(order => {
      // Check if status looks like a UTR (12-digit number)
      if (order.status && /^\d{12}$/.test(order.status)) {
        order.utr = order.status;
        order.status = 'Confirming';
        repairedCount++;
      }
    });
    if (repairedCount > 0) {
      console.log(`[Database Repair] Corrected ${repairedCount} orders with UTR numbers in status column.`);
      saveDb();
    }
  }
}

async function saveBase64File(base64Str, prefix) {
  if (!base64Str) return null;
  if (base64Str.startsWith('http://') || base64Str.startsWith('https://')) return base64Str;
  
  try {
    const matches = base64Str.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      return base64Str.startsWith('/') ? base64Str : null;
    }
    const type = matches[1];
    const buffer = Buffer.from(matches[2], 'base64');
    let ext = 'png';
    if (type.includes('jpeg') || type.includes('jpg')) ext = 'jpg';
    else if (type.includes('pdf')) ext = 'pdf';
    else if (type.includes('webp')) ext = 'webp';

    const filename = `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000)}.${ext}`;

    const uploadsDir = path.join(__dirname, '../public/uploads');
    try {
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
      const filePath = path.join(uploadsDir, filename);
      fs.writeFileSync(filePath, buffer);
      return `/uploads/${filename}`;
    } catch (e) {
      console.warn('[DB] Upload filesystem write skipped in serverless:', e.message);
      return base64Str; // Return base64 data URI directly if disk write unavailable
    }
  } catch (err) {
    console.error('Error saving base64 file:', err);
    return null;
  }
}

// Immediately load on module load
loadDb();

module.exports = {
  db: {},
  query,
  initDb,
  dbData,
  idTrackers,
  saveDb,
  loadDb,
  persistToDb,
  saveBase64File
 };

