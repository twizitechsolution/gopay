const { dbData, saveDb, query } = require('./db');
const { supabase, isSupabaseConnected } = require('./supabase');

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
          // Check if user has bank account
          const hasBank = dbData.bank_accounts && dbData.bank_accounts.some(b => b.user_id == u.id);
          // Check if user has completed plan/deposit orders
          const hasPlans = dbData.orders && dbData.orders.some(o => o.user_id == u.id && o.status === 'Completed');
          // Check if user has active balance or transactions
          const hasBalance = (Number(u.inr_balance) > 0 || Number(u.bcoin_balance) > 0);
          const hasActivity = dbData.transactions && dbData.transactions.some(t => t.user_id == u.id);

          if (!hasBank && !hasPlans && !hasBalance && !hasActivity) {
            userIdsToDelete.push(u.id);
            continue; // purge inactive user
          }
        }
        usersToKeep.push(u);
      }

      purgedUsersCount = dbData.users.length - usersToKeep.length;
      dbData.users = usersToKeep;

      if (userIdsToDelete.length > 0 && isSupabaseConnected()) {
        await supabase.from('users').delete().in('id', userIdsToDelete);
      }
    }

    // Supabase DB Purge
    if (isSupabaseConnected()) {
      await supabase.from('transactions').delete().lt('created_at', sevenDaysAgoIso);
      await supabase.from('orders').delete().lt('created_at', sevenDaysAgoIso).in('status', ['Completed', 'Canceled']);
    }

    saveDb();
    console.log(`[Cleanup] Completed successfully: Purged ${purgedTransactionsCount} old transactions, ${purgedOrdersCount} old orders, ${purgedUsersCount} inactive accounts.`);

    return {
      success: true,
      purgedTransactionsCount,
      purgedOrdersCount,
      purgedUsersCount,
      timestamp: now.toISOString()
    };
  } catch (err) {
    console.error('[Cleanup] Error during 7-day maintenance:', err.message);
    return { success: false, error: err.message };
  }
}

// Schedule daily run at midnight
function scheduleMidnightCleanup() {
  const checkInterval = 60 * 60 * 1000; // Check every hour
  let lastRunDate = null;

  setInterval(async () => {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    // Run if past midnight (00:00 - 01:00) and hasn't run today
    if (now.getHours() === 0 && lastRunDate !== todayStr) {
      lastRunDate = todayStr;
      await runSevenDayCleanup();
    }
  }, checkInterval);
}

module.exports = {
  runSevenDayCleanup,
  scheduleMidnightCleanup
};
