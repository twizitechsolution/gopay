const { dbData, saveDb, query } = require('./db');
const { isMysqlConnected, queryMysql } = require('./mysql');

/**
 * 7-Day Auto Cleanup Service
 * 1. Purges deposit and withdrawal history older than 7 days.
 * 2. Deletes inactive user accounts registered > 7 days ago without bank account, plan purchase, or activity.
 */
async function runSevenDayCleanup() {
  console.log('[Cleanup] Starting 7-day automated database maintenance...');
  const { loadDb } = require('./db');
  loadDb();

  if (!dbData.settings || !dbData.settings.enable_auto_cleanup) {
    console.log('[Cleanup] 7-day auto-purge is disabled by default to protect historical ledger data.');
    return { 
      success: true, 
      purgedTransactionsCount: 0, 
      purgedOrdersCount: 0, 
      purgedUsersCount: 0,
      message: 'Cleanup skipped (enable_auto_cleanup setting is off to prevent historical data loss).' 
    };
  }

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const sevenDaysAgoIso = sevenDaysAgo.toISOString();

  let purgedOrdersCount = 0;
  let purgedTransactionsCount = 0;
  let purgedUsersCount = 0;

  try {
    // 1. Purge old transactions (Deposit & Withdraw) older than 7 days
    if (dbData.transactions && Array.isArray(dbData.transactions)) {
      const beforeCount = dbData.transactions.length;
      dbData.transactions = dbData.transactions.filter(t => {
        if (!t.created_at) return true;
        const createdDate = new Date(t.created_at);
        if (createdDate < sevenDaysAgo) {
          return false; // delete
        }
        return true;
      });
      purgedTransactionsCount = beforeCount - dbData.transactions.length;
    }

    // 2. Purge old completed deposit orders older than 7 days
    if (dbData.orders && Array.isArray(dbData.orders)) {
      const beforeOrders = dbData.orders.length;
      dbData.orders = dbData.orders.filter(o => {
        if (!o.created_at) return true;
        const createdDate = new Date(o.created_at);
        if (createdDate < sevenDaysAgo && (o.status === 'Completed' || o.status === 'Canceled')) {
          return false; // delete old settled order
        }
        return true;
      });
      purgedOrdersCount = beforeOrders - dbData.orders.length;
    }

    // 3. Purge inactive users registered > 7 days ago without bank account or active plans
    if (dbData.users && Array.isArray(dbData.users)) {
      const usersToKeep = [];
      const userIdsToDelete = [];

      for (const u of dbData.users) {
        if (!u.created_at) {
          usersToKeep.push(u);
          continue;
        }
        const userCreated = new Date(u.created_at);
        if (userCreated < sevenDaysAgo) {
          const hasBank = dbData.bank_accounts && dbData.bank_accounts.some(b => b.user_id == u.id);
          const hasPlans = dbData.orders && dbData.orders.some(o => o.user_id == u.id && o.status === 'Completed');
          const hasBalance = (Number(u.inr_balance) > 0 || Number(u.bcoin_balance) > 0);
          const hasActivity = dbData.transactions && dbData.transactions.some(t => t.user_id == u.id);

          if (!hasBank && !hasPlans && !hasBalance && !hasActivity) {
            userIdsToDelete.push(u.id);
            continue;
          }
        }
        usersToKeep.push(u);
      }

      purgedUsersCount = dbData.users.length - usersToKeep.length;
      dbData.users = usersToKeep;

      if (userIdsToDelete.length > 0 && isMysqlConnected()) {
        try {
          const placeholders = userIdsToDelete.map(() => '?').join(',');
          await queryMysql(`DELETE FROM users WHERE id IN (${placeholders})`, userIdsToDelete);
        } catch (e) {
          console.error('[Cleanup] Error deleting inactive users from MySQL:', e.message);
        }
      }
    }

    // MySQL Purge
    if (isMysqlConnected()) {
      try {
        await queryMysql('DELETE FROM transactions WHERE created_at < ?', [sevenDaysAgoIso]);
        await queryMysql("DELETE FROM orders WHERE created_at < ? AND status IN ('Completed', 'Canceled')", [sevenDaysAgoIso]);
      } catch (e) {
        console.error('[Cleanup] Error purging old ledger data from MySQL:', e.message);
      }
    }

    saveDb();
    console.log(`[Cleanup] Completed successfully: Purged ${purgedTransactionsCount} old transactions, ${purgedOrdersCount} old orders, ${purgedUsersCount} inactive accounts.`);

    return {
      success: true,
      purgedTransactionsCount,
      purgedOrdersCount,
      purgedUsersCount,
      message: `Successfully purged ${purgedTransactionsCount} transactions, ${purgedOrdersCount} orders, and ${purgedUsersCount} inactive accounts.`
    };
  } catch (err) {
    console.error('[Cleanup] Error running 7-day database cleanup:', err.message);
    return {
      success: false,
      error: err.message
    };
  }
}

/**
 * Schedule automated daily cleanup check at 03:00 AM
 */
function initCleanupScheduler() {
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  setInterval(() => {
    try {
      runSevenDayCleanup();
    } catch (e) {
      console.error('[Cleanup Scheduler] Background job execution error:', e.message);
    }
  }, ONE_DAY_MS);

  // Run initial lightweight cleanup 10 seconds after server boot
  setTimeout(() => {
    try {
      runSevenDayCleanup();
    } catch (e) {
      console.warn('[Cleanup Initial Check] Error:', e.message);
    }
  }, 10000);
}

module.exports = {
  runSevenDayCleanup,
  initCleanupScheduler,
  scheduleMidnightCleanup: initCleanupScheduler
};
