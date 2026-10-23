const { query, dbData, idTrackers, saveDb, loadDb, persistToSupabase } = require('../db');

// Helper to generate custom order IDs: gn/gu + YYYYMMDDHHMMSS + 6-digit uppercase hex
function generateOrderId(prefix) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  
  const timestamp = `${year}${month}${day}${hours}${minutes}${seconds}`;
  const randomPart = Math.floor(0x100000 + Math.random() * 0xefffff).toString(16).toUpperCase();
  
  return `${prefix}${timestamp}${randomPart}`;
}

const https = require('https');
const crypto = require('crypto');

// In-memory active quotes map to lock sellers for the 15-minute quote window
const activeQuotes = new Map();
exports.activeQuotes = activeQuotes;

async function winpeyCreatePayment(orderId, amount, username, origin) {
  const config = await query.get('SELECT * FROM settings LIMIT 1');
  const apiKey = process.env.WINPEY_API_KEY || config?.winpey_api_key || "488b923c-2b03-465e-b9df-55d018124e0c";
  const apiSecret = process.env.WINPEY_API_SECRET || config?.winpey_api_secret || "fc4a56a2439f47c19213c747ee5693c6";

  return new Promise((resolve, reject) => {

    // Setup public notify and redirect URLs for Winpey payment gateway
    const publicBaseUrl = process.env.PUBLIC_URL || (origin && !origin.includes('localhost') ? origin : 'https://gopay.online');
    const notifyUrl = `${publicBaseUrl}/api/payment/callback`;
    const redirectUrl = `${publicBaseUrl}/api/payment/return?order_id=${orderId}`;

    const payload = {
      merchant_order_id: orderId,
      amount: Number(amount).toFixed(2),
      user_name: username || 'Customer',
      notify_url: notifyUrl,
      redirect_url: redirectUrl,
      currency: "INR",
      ext: orderId
    };

    // Generate Signature
    const signParams = {...payload};
    const sortedKeys = Object.keys(signParams).sort();
    const joined = sortedKeys.map(k => `${k}=${signParams[k]}`).join('&');
    const stringToSign = `${joined}&key=${apiSecret}`;
    const signature = crypto.createHash('sha256').update(stringToSign).digest('hex').toLowerCase();

    payload.sign = signature;

    const dataString = JSON.stringify(payload);

    const options = {
      hostname: 'winpey.us.cc',
      port: 443,
      path: '/api/v1/pay/create',
      method: 'POST',
      headers: {
        'X-Api-Key': apiKey,
        'X-Api-Secret': apiSecret,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(dataString)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve(parsed);
        } catch (e) {
          reject(new Error(`Failed to parse response: ${body}`));
        }
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    req.write(dataString);
    req.end();
  });
}

async function winpeyQueryPayment(orderId) {
  const config = await query.get('SELECT * FROM settings LIMIT 1');
  const apiKey = process.env.WINPEY_API_KEY || config?.winpey_api_key || "488b923c-2b03-465e-b9df-55d018124e0c";
  const apiSecret = process.env.WINPEY_API_SECRET || config?.winpey_api_secret || "fc4a56a2439f47c19213c747ee5693c6";

  return new Promise((resolve, reject) => {
    const payload = {
      merchant_order_id: orderId
    };

    // Generate Query Signature
    const stringToSign = `merchant_order_id=${orderId}&key=${apiSecret}`;
    const signature = crypto.createHash('sha256').update(stringToSign).digest('hex').toLowerCase();
    payload.sign = signature;

    const dataString = JSON.stringify(payload);

    const options = {
      hostname: 'winpey.us.cc',
      port: 443,
      path: '/api/v1/pay/query',
      method: 'POST',
      headers: {
        'X-Api-Key': apiKey,
        'X-Api-Secret': apiSecret,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(dataString)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve(parsed);
        } catch (e) {
          reject(new Error(`Failed to parse query response: ${body}`));
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.write(dataString);
    req.end();
  });
}

exports.getPaymentQuote = async (req, res) => {
  const userId = req.user.id;
  const { assetType, amount } = req.body;

  if (!assetType || !amount) {
    return res.status(400).json({ error: 'Please provide assetType and amount' });
  }

  const amtNum = Number(amount);
  if (isNaN(amtNum) || amtNum <= 0) {
    return res.status(400).json({ error: 'Amount must be a positive number' });
  }

  // Enforce Admin configured Min / Max order limits
  loadDb();
  try {
    const { supabase, isSupabaseConnected } = require('../supabase');
    if (isSupabaseConnected()) {
      const { data } = await supabase.from('settings').select('*').eq('key', 'config').maybeSingle();
      if (data && data.value) {
        dbData.settings = { ...(dbData.settings || {}), ...data.value };
      }
    }
  } catch (_) {}
  const cfg = dbData.settings || {};
  const minLimit = Number(cfg.min_order_amount) > 0 ? Number(cfg.min_order_amount) : 500;
  const maxLimit = Number(cfg.max_order_amount) > 0 ? Number(cfg.max_order_amount) : 100000;

  if (amtNum < minLimit) {
    return res.status(400).json({ error: `Order amount cannot be less than ₹${minLimit}` });
  }
  if (amtNum > maxLimit) {
    return res.status(400).json({ error: `Order amount cannot exceed ₹${maxLimit}` });
  }

  try {
    let expectedIncome = 0;
    let quota = 0;
    let tempOrderId = '';

    if (assetType === 'INR') {
      expectedIncome = (amtNum * 0.10) + 8.0;
      quota = amtNum + expectedIncome;
      tempOrderId = generateOrderId('gn');
    } else if (assetType === 'USDT') {
      const inrValue = amtNum * 100.0;
      expectedIncome = inrValue * 0.20;
      quota = inrValue + expectedIncome;
      tempOrderId = generateOrderId('gu');
    } else {
      return res.status(400).json({ error: 'Invalid asset type. Must be INR or USDT.' });
    }

    let receiverId = null;
    let withdrawalId = null;
    let timerExpiry = null;
    let receiverDetails = null;

    if (assetType === 'INR') {
      loadDb();

      // Clean up any expired quotes from activeQuotes map
      const nowMs = Date.now();
      for (const [key, q] of activeQuotes.entries()) {
        if (!q.timerExpiry || nowMs > new Date(q.timerExpiry).getTime()) {
          activeQuotes.delete(key);
        }
      }

      // Find eligible P2P sellers: MUST HAVE AN EXPLICIT PENDING WITHDRAWAL REQUEST!
      // A regular customer who did NOT request a withdrawal must NEVER have their balance deducted!
      const eligibleWithdrawals = (dbData.withdrawals || []).filter(w => {
        if (w.status !== 'Pending' || Number(w.amount_pending || 0) < amtNum) return false;
        const seller = (dbData.users || []).find(u => u.id == w.user_id);
        if (!seller || seller.id == userId || seller.id == 1 || seller.is_blocked) return false;
        if (Number(seller.bcoin_balance || 0) < amtNum) return false;

        const hasActiveBank = (dbData.bank_accounts || []).some(b => b.user_id == seller.id && b.status === 'Active');
        if (!hasActiveBank) return false;

        // STRICT CONCURRENCY LOCK 1: Must NOT have any active/undecided orders assigned as receiver
        const hasActiveOrder = (dbData.orders || []).some(o => 
          o.receiver_id == seller.id && ['Pending', 'Confirming', 'Admin Review', 'Disputed'].includes(o.status)
        );
        if (hasActiveOrder) return false;

        // STRICT CONCURRENCY LOCK 2: Must NOT have any active unexpired quote currently assigned in memory
        const hasActiveQuote = Array.from(activeQuotes.values()).some(q => 
          q.receiverId == seller.id && nowMs < new Date(q.timerExpiry).getTime()
        );
        if (hasActiveQuote) return false;

        return true;
      });

      let matchedUser = null;
      if (eligibleWithdrawals.length > 0) {
        // Uniform fair rotation across all eligible withdrawal requests
        const shuffled = [...eligibleWithdrawals].sort(() => Math.random() - 0.5);
        const selectedW = shuffled[0];
        matchedUser = (dbData.users || []).find(u => u.id == selectedW.user_id);
        withdrawalId = selectedW.id;
      }

      if (matchedUser) {
        receiverId = matchedUser.id;
        timerExpiry = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        
        const activeBanks = dbData.bank_accounts.filter(b => b.user_id == receiverId && b.status === 'Active');
        const bank = activeBanks.length > 0 
          ? activeBanks[Math.floor(Math.random() * activeBanks.length)]
          : (dbData.bank_accounts.find(b => b.user_id == receiverId) || {});

        const receiverUser = matchedUser;
        const settings = dbData.settings || {};
        const fallbackUpi = settings.upi_ids ? settings.upi_ids.split(',')[0].trim() : 'merchant@upi';

        receiverDetails = {
          receiver_name: bank.account_holder || receiverUser.username || 'P2P Merchant',
          bank_name: bank.bank_name || 'Bank',
          account_number: bank.account_number || 'N/A',
          ifsc_code: bank.ifsc_code || 'N/A',
          upi_id: bank.upi_id || (receiverUser.mobile ? `${receiverUser.mobile}@upi` : fallbackUpi),
          mobile: receiverUser.mobile
        };
      } else {
        // Fallback to Official Merchant
        receiverId = null;
        timerExpiry = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        
        const settings = dbData.settings || {};
        const upiList = settings.upi_ids ? settings.upi_ids.split(',').map(s => s.trim()).filter(Boolean) : [];
        const fallbackUpi = upiList.length > 0 ? upiList[Math.floor(Math.random() * upiList.length)] : 'Earnclub@apl';

        receiverDetails = {
          receiver_name: 'Official Merchant',
          bank_name: 'UPI / Official Payment',
          account_number: 'N/A',
          ifsc_code: 'N/A',
          upi_id: fallbackUpi,
          mobile: 'N/A'
        };
      }
    } else {
      const settings = dbData.settings || {};
      receiverDetails = {
        receiver_name: 'USDT Merchant Wallet',
        bank_name: 'Tether TRC20',
        account_number: settings.upi_ids ? settings.upi_ids.split(',')[0].trim() : 'TY4Wj3k3gP1P2b... (TRC20)',
        ifsc_code: 'TRC20',
        upi_id: 'usdt@wallet',
        mobile: '0000000000'
      };
      timerExpiry = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    }

    // Cache virtual quote details in memory so submit-p2p uses exact plan amount
    activeQuotes.set(tempOrderId, {
      amount: amtNum,
      assetType,
      expectedIncome,
      quota,
      receiverId,
      withdrawalId,
      timerExpiry,
      receiverDetails
    });

    // Also persist quote immediately to Supabase Cloud so any serverless lambda instance can retrieve it
    try {
      const { supabase, isSupabaseConnected } = require('../supabase');
      if (isSupabaseConnected()) {
        await supabase.from('orders').upsert({
          order_id: tempOrderId,
          user_id: userId,
          asset_type: assetType,
          amount: amtNum,
          expected_income: expectedIncome,
          quota: quota,
          status: 'Quote',
          receiver_id: receiverId,
          withdrawal_id: withdrawalId || null,
          timer_expiry: timerExpiry,
          receiver_details: receiverDetails,
          created_at: new Date().toISOString()
        });
      }
    } catch (_) {}

    return res.json({
      success: true,
      order: {
        order_id: tempOrderId,
        tempOrderId,
        asset_type: assetType,
        amount: amtNum,
        expected_income: expectedIncome,
        quota: quota,
        status: 'Quote',
        receiver_id: receiverId,
        withdrawal_id: withdrawalId,
        timer_expiry: timerExpiry,
        receiver_details: receiverDetails
      },
      quote: {
        tempOrderId,
        assetType,
        amount: amtNum,
        expectedIncome,
        quota,
        receiver_id: receiverId,
        withdrawal_id: withdrawalId,
        timer_expiry: timerExpiry,
        receiver_details: receiverDetails
      }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

exports.createOrder = async (req, res) => {
  const userId = req.user.id;
  let { assetType, amount, utr, screenshot, receiver_id, withdrawal_id } = req.body;
  let orderId = req.params && req.params.orderId && req.params.orderId.length > 5 ? req.params.orderId : '';

  const cleanUtr = utr ? String(utr).trim() : '';

  // PRE-SUBMISSION QUOTE GUARD:
  // If UTR is missing or NOT_SUBMITTED, return a virtual payment quote WITHOUT saving any row in DB or Admin Panel!
  if (!cleanUtr || cleanUtr.length < 8 || cleanUtr.toUpperCase() === 'NOT_SUBMITTED') {
    return exports.getPaymentQuote(req, res);
  }

  // Look up quote from memory cache OR Supabase Cloud (essential for stateless Vercel lambdas)
  let cachedQuote = null;
  if (orderId && activeQuotes.has(orderId)) {
    cachedQuote = activeQuotes.get(orderId);
  }
  if (!cachedQuote && orderId) {
    try {
      const { supabase, isSupabaseConnected } = require('../supabase');
      if (isSupabaseConnected()) {
        const { data: dbQuote } = await supabase.from('orders').select('*').eq('order_id', orderId).maybeSingle();
        if (dbQuote && Number(dbQuote.amount) > 0) {
          cachedQuote = {
            amount: Number(dbQuote.amount),
            assetType: dbQuote.asset_type || 'INR',
            receiverId: dbQuote.receiver_id,
            withdrawalId: dbQuote.withdrawal_id,
            receiverDetails: dbQuote.receiver_details
          };
        }
      }
    } catch (_) {}
  }

  if (!amount || Number(amount) <= 0) {
    if (cachedQuote && cachedQuote.amount > 0) {
      amount = cachedQuote.amount;
    }
  }

  if (!assetType) {
    if (cachedQuote && cachedQuote.assetType) {
      assetType = cachedQuote.assetType;
    } else {
      assetType = 'INR';
    }
  }

  if (!receiver_id && cachedQuote && cachedQuote.receiverId) {
    receiver_id = cachedQuote.receiverId;
  }

  if (!withdrawal_id && cachedQuote && cachedQuote.withdrawalId) {
    withdrawal_id = cachedQuote.withdrawalId;
  }

  const amtNum = Number(amount);
  if (isNaN(amtNum) || amtNum <= 0) {
    return res.status(400).json({ error: 'Order quote expired or invalid amount. Please select an order again.' });
  }

  // Enforce Admin configured Min / Max order limits
  loadDb();
  try {
    const { supabase, isSupabaseConnected } = require('../supabase');
    if (isSupabaseConnected()) {
      const { data } = await supabase.from('settings').select('*').eq('key', 'config').maybeSingle();
      if (data && data.value) {
        dbData.settings = { ...(dbData.settings || {}), ...data.value };
      }
    }
  } catch (_) {}
  const cfg = dbData.settings || {};
  const minLimit = Number(cfg.min_order_amount) > 0 ? Number(cfg.min_order_amount) : 500;
  const maxLimit = Number(cfg.max_order_amount) > 0 ? Number(cfg.max_order_amount) : 100000;

  if (amtNum < minLimit) {
    return res.status(400).json({ error: `Order amount cannot be less than ₹${minLimit}` });
  }
  if (amtNum > maxLimit) {
    return res.status(400).json({ error: `Order amount cannot exceed ₹${maxLimit}` });
  }

  loadDb();

  // Strict Duplicate UTR Validation across all orders
  const existingUtr = (dbData.orders || []).find(o => o.utr && String(o.utr).trim().toLowerCase() === cleanUtr.toLowerCase());
  if (existingUtr) {
    return res.status(400).json({ error: 'This UTR transaction reference has already been submitted. Fake or duplicate UTRs are rejected.' });
  }

  try {
    let expectedIncome = 0;
    let quota = 0;
    let orderId = req.params && req.params.orderId && req.params.orderId.length > 5 ? req.params.orderId : '';

    if (assetType === 'INR') {
      expectedIncome = (amtNum * 0.10) + 8.0;
      quota = amtNum + expectedIncome;
      if (!orderId) orderId = generateOrderId('gn');
    } else if (assetType === 'USDT') {
      const inrValue = amtNum * 100.0;
      expectedIncome = inrValue * 0.20;
      quota = inrValue + expectedIncome;
      if (!orderId) orderId = generateOrderId('gu');
    } else {
      return res.status(400).json({ error: 'Invalid asset type.' });
    }

    const timerExpiry = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const finalReceiverId = receiver_id || null;

    // Build receiver details
    let receiverDetails = null;
    if (finalReceiverId) {
      const bank = (dbData.bank_accounts || []).find(b => b.user_id == finalReceiverId && b.status === 'Active');
      const receiverUser = (dbData.users || []).find(u => u.id == finalReceiverId);
      if (bank && receiverUser) {
        receiverDetails = {
          receiver_name: bank.account_holder,
          bank_name: bank.bank_name,
          account_number: bank.account_number,
          ifsc_code: bank.ifsc_code,
          upi_id: bank.upi_id || `${receiverUser.mobile}@upi`,
          mobile: receiverUser.mobile
        };
      }
    }

    if (!receiverDetails) {
      const settings = dbData.settings || {};
      const upiList = settings.upi_ids ? settings.upi_ids.split(',').map(s => s.trim()).filter(Boolean) : [];
      const fallbackUpi = upiList.length > 0 ? upiList[Math.floor(Math.random() * upiList.length)] : 'Earnclub@apl';

      receiverDetails = {
        receiver_name: 'Official Merchant',
        bank_name: 'UPI / Official Payment',
        account_number: 'N/A',
        ifsc_code: 'N/A',
        upi_id: fallbackUpi,
        mobile: 'N/A'
      };
    }

    // Save screenshot if provided
    let screenshotPath = null;
    if (screenshot) {
      const { saveBase64File } = require('../db');
      screenshotPath = await saveBase64File(screenshot, 'screenshot');
    }

    await query.run(`
      INSERT INTO orders (order_id, user_id, asset_type, amount, expected_income, quota, status, utr)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [orderId, userId, assetType, amtNum, expectedIncome, quota, 'Confirming', cleanUtr]);

    loadDb();
    const order = dbData.orders.find(o => o.order_id === orderId);
    if (order) {
      order.receiver_id = finalReceiverId;
      order.timer_expiry = timerExpiry;
      order.receiver_details = receiverDetails;
      if (screenshotPath) order.screenshot_path = screenshotPath;

      if (withdrawal_id) {
        const w = dbData.withdrawals.find(x => x.id == withdrawal_id);
        if (w) {
          order.withdrawal_id = w.id;
          w.amount_pending = Math.max(0, w.amount_pending - amtNum);
        }
      }
      activeQuotes.delete(orderId);
      saveDb();
      persistToSupabase('orders', order, 'update', 'order_id');
      if (withdrawal_id) {
        const w = dbData.withdrawals.find(x => x.id == withdrawal_id);
        if (w) persistToSupabase('withdrawals', w, 'update', 'id');
      }
    }

    const createdOrder = await query.get('SELECT * FROM orders WHERE order_id = ?', [orderId]);
    return res.status(201).json({
      success: true,
      message: 'Deposit submitted successfully! Awaiting verification.',
      order: {
        ...createdOrder,
        receiver_id: finalReceiverId,
        withdrawal_id: withdrawal_id || null,
        timer_expiry: timerExpiry,
        receiver_details: receiverDetails
      }
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

exports.submitUtr = async (req, res) => {
  const userId = req.user.id;
  const { orderId, utr } = req.body;

  if (!orderId || !utr) {
    return res.status(400).json({ error: 'Please provide Order ID and UTR' });
  }

  try {
    const order = await query.get('SELECT * FROM orders WHERE order_id = ? AND user_id = ?', [orderId, userId]);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.status !== 'Confirming') {
      return res.status(400).json({ error: `Cannot submit UTR for order with status: ${order.status}` });
    }

    await query.run('UPDATE orders SET utr = ? WHERE order_id = ?', [utr, orderId]);
    return res.json({ success: true, message: 'UTR reference submitted successfully!' });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

exports.listOrders = async (req, res) => {
  const userId = req.user.id;
  try {
    const orders = await query.all('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC', [userId]);
    return res.json({ success: true, orders });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

const executeOrderApproval = async (order, txnId) => {
  const { supabase, isSupabaseConnected } = require('../supabase');

  // Re-verify latest status from database or Supabase to prevent duplicate processing
  let currentOrder = await query.get('SELECT * FROM orders WHERE order_id = ?', [order.order_id]);
  if (!currentOrder && isSupabaseConnected()) {
    try {
      const { data: suO } = await supabase.from('orders').select('*').eq('order_id', order.order_id).maybeSingle();
      if (suO) currentOrder = suO;
    } catch (_) {}
  }
  if (currentOrder && currentOrder.status === 'Completed') {
    console.warn(`[OrderApproval] Order ${order.order_id} is already completed. Skipping duplicate approval.`);
    return;
  }

  const finalUtr = txnId || order.utr || 'ADMIN_AUTO';
  const completedAt = new Date().toISOString();

  // 1. Update order status to Completed in local DB
  await query.run('UPDATE orders SET status = "Completed", utr = ? WHERE order_id = ?', [finalUtr, order.order_id]);

  loadDb();
  const dbOrder = (dbData.orders || []).find(o => o.order_id === order.order_id);
  if (dbOrder) {
    dbOrder.status = 'Completed';
    dbOrder.utr = finalUtr;
    dbOrder.completed_at = completedAt;
  }

  // 1b. Update order status to Completed in Supabase Cloud
  if (isSupabaseConnected()) {
    try {
      await supabase.from('orders').update({
        status: 'Completed',
        utr: finalUtr
      }).eq('order_id', order.order_id);
    } catch (e) {
      console.warn('[executeOrderApproval] Supabase order update warning:', e.message);
    }
  }

  // 1c. ONLY if matched to an ACTUAL P2P withdrawal seller (withdrawal_id exists & receiver_id > 1)
  const linkedWithdrawalId = order.withdrawal_id || (dbOrder ? dbOrder.withdrawal_id : null);
  const receiverId = order.receiver_id || (dbOrder ? dbOrder.receiver_id : null);
  if (linkedWithdrawalId && receiverId && receiverId != 1) {
    let seller = (dbData.users || []).find(u => u.id == receiverId);
    if (!seller && isSupabaseConnected()) {
      try {
        const { data: suSeller } = await supabase.from('users').select('*').eq('id', receiverId).maybeSingle();
        if (suSeller) seller = suSeller;
      } catch (_) {}
    }
    if (seller) {
      seller.bcoin_balance = Math.max(0, Number(seller.bcoin_balance || 0) - Number(order.amount));

      const bank = (dbData.bank_accounts || []).find(b => b.user_id == seller.id && b.status === 'Active')
        || (dbData.bank_accounts || []).find(b => b.user_id == seller.id)
        || { bank_name: 'Bank', account_number: 'N/A', account_holder: seller.username };

      const desc = `Bank: ${bank.bank_name}, A/C: ${bank.account_number}, Holder: ${bank.account_holder}, UTR: ${finalUtr}, TXID: MWD_${Date.now()}, Note: P2P match withdrawal debit of ₹${Number(order.amount).toFixed(2)}`;

      const newTxId = ++idTrackers.transactions;
      const withdrawTx = {
        id: newTxId,
        user_id: seller.id,
        type: 'Withdraw',
        amount: -Number(order.amount),
        balance_after: seller.bcoin_balance,
        status: 'Completed',
        order_id: order.order_id,
        description: desc,
        created_at: completedAt
      };
      dbData.transactions.push(withdrawTx);

      const w = (dbData.withdrawals || []).find(x => x.id == linkedWithdrawalId);
      if (w) {
        w.amount_pending = Math.max(0, Number(w.amount_pending || 0) - Number(order.amount));
        if (w.amount_pending <= 0) {
          w.status = 'Completed';
        }
      }
      saveDb();
      persistToSupabase('transactions', withdrawTx, 'upsert', 'id');
      persistToSupabase('users', seller, 'update', 'id');
      if (w) persistToSupabase('withdrawals', w, 'update', 'id');
    }
  }

  // 2. Fetch the user who placed this order (buyer)
  let buyer = await query.get('SELECT * FROM users WHERE id = ?', [order.user_id]);
  if (!buyer && isSupabaseConnected()) {
    try {
      const { data: suBuyer } = await supabase.from('users').select('*').eq('id', order.user_id).maybeSingle();
      if (suBuyer) buyer = suBuyer;
    } catch (_) {}
  }
  if (!buyer) {
    console.error(`[OrderApproval] Buyer user ${order.user_id} not found in database!`);
    return;
  }
  
  // Credit amount + expected reward (quota) to user bcoin_balance (T Coin), and credit total earnings
  const currentBcoin = Number(buyer.bcoin_balance || 0);
  const currentInr = Number(buyer.inr_balance || 0);
  const currentTotalEarnings = Number(buyer.total_earnings || 0);
  const currentTodayProfit = Number(buyer.today_profit || 0);

  const updatedBcoinBalance = currentBcoin + Number(order.quota || 0);
  const updatedInrBalance = currentInr;
  const updatedTotalEarnings = currentTotalEarnings + Number(order.expected_income || 0);
  const updatedTodayProfit = currentTodayProfit + Number(order.expected_income || 0);

  buyer.bcoin_balance = updatedBcoinBalance;
  buyer.total_earnings = updatedTotalEarnings;
  buyer.today_profit = updatedTodayProfit;

  await query.run(`
    UPDATE users 
    SET inr_balance = ?, bcoin_balance = ?, total_earnings = ?, today_profit = ?
    WHERE id = ?
  `, [updatedInrBalance, updatedBcoinBalance, updatedTotalEarnings, updatedTodayProfit, buyer.id]);

  if (isSupabaseConnected()) {
    try {
      await supabase.from('users').update({
        inr_balance: updatedInrBalance,
        bcoin_balance: updatedBcoinBalance,
        total_earnings: updatedTotalEarnings,
        today_profit: updatedTodayProfit
      }).eq('id', buyer.id);
    } catch (e) {
      console.warn('[executeOrderApproval] Supabase buyer update warning:', e.message);
    }
  }

  // Log transactions for the buyer (Quota History)
  // 1. Log the principal Deposit transaction
  const balanceAfterDeposit = currentBcoin + Number(order.amount || 0);
  const newTx1 = ++idTrackers.transactions;
  const depTx = {
    id: newTx1,
    user_id: buyer.id,
    type: 'Deposit',
    amount: Number(order.amount),
    balance_after: balanceAfterDeposit,
    description: `Deposit principal for Order ${order.order_id}`,
    created_at: completedAt
  };
  dbData.transactions.push(depTx);
  persistToSupabase('transactions', depTx, 'upsert', 'id');

  // 2. Log the expected income (Bonus) transaction
  const newTx2 = ++idTrackers.transactions;
  const bonusTx = {
    id: newTx2,
    user_id: buyer.id,
    type: 'Commission',
    amount: Number(order.expected_income),
    balance_after: updatedBcoinBalance,
    description: `Interest bonus for Order ${order.order_id}`,
    created_at: completedAt
  };
  dbData.transactions.push(bonusTx);
  persistToSupabase('transactions', bonusTx, 'upsert', 'id');
  saveDb();

  // 3. Process 3-Level Commission Engine
  const config = await query.get('SELECT * FROM settings LIMIT 1');
  const rates = config || { level1_commission: 10, level2_commission: 5, level3_commission: 2 };
  
  const commissionRates = [
    Number(rates.level1_commission || 0) / 100,
    Number(rates.level2_commission || 0) / 100,
    Number(rates.level3_commission || 0) / 100
  ];

  let currentParentId = buyer.parent_id;
  const depositAmountInInr = order.asset_type === 'USDT' ? order.amount * 100.0 : order.amount;

  for (let level = 1; level <= 3; level++) {
    if (!currentParentId) break;

    let parent = await query.get('SELECT * FROM users WHERE id = ?', [currentParentId]);
    if (!parent && isSupabaseConnected()) {
      try {
        const { data: suParent } = await supabase.from('users').select('*').eq('id', currentParentId).maybeSingle();
        if (suParent) parent = suParent;
      } catch (_) {}
    }
    if (!parent) break;

    const rate = commissionRates[level - 1];
    const commAmount = depositAmountInInr * rate;

    if (commAmount > 0) {
      const newParentBcoinBalance = Number(parent.bcoin_balance || 0) + commAmount;
      const newParentTotalEarnings = Number(parent.total_earnings || 0) + commAmount;
      const newParentTodayProfit = Number(parent.today_profit || 0) + commAmount;

      parent.bcoin_balance = newParentBcoinBalance;
      parent.total_earnings = newParentTotalEarnings;
      parent.today_profit = newParentTodayProfit;

      await query.run(`
        UPDATE users 
        SET inr_balance = ?, bcoin_balance = ?, total_earnings = ?, today_profit = ?
        WHERE id = ?
      `, [Number(parent.inr_balance || 0), newParentBcoinBalance, newParentTotalEarnings, newParentTodayProfit, parent.id]);

      if (isSupabaseConnected()) {
        try {
          await supabase.from('users').update({
            bcoin_balance: newParentBcoinBalance,
            total_earnings: newParentTotalEarnings,
            today_profit: newParentTodayProfit
          }).eq('id', parent.id);
        } catch (_) {}
      }

      const newParentTxId = ++idTrackers.transactions;
      const commTx = {
        id: newParentTxId,
        user_id: parent.id,
        type: 'Commission',
        amount: commAmount,
        balance_after: newParentBcoinBalance,
        description: `Level ${level} Commission of ₹${commAmount.toFixed(2)} from member UID: ${buyer.uid} (Order ID: ${order.order_id})`,
        created_at: completedAt
      };
      dbData.transactions.push(commTx);
      persistToSupabase('transactions', commTx, 'upsert', 'id');
      saveDb();
    }

    currentParentId = parent.parent_id;
  }
};

// --- SIMULATED ADMIN CONTROL API ---
exports.adminApproveOrder = async (req, res) => {
  const { orderId } = req.params;

  try {
    let order = null;
    const { supabase, isSupabaseConnected } = require('../supabase');
    if (isSupabaseConnected()) {
      try {
        const { data: suO } = await supabase.from('orders').select('*').eq('order_id', orderId).maybeSingle();
        if (suO) order = suO;
      } catch (_) {}
    }
    if (!order) {
      order = await query.get('SELECT * FROM orders WHERE order_id = ?', [orderId]);
    }

    if (!order) {
      return res.status(404).json({ error: 'Order not found in database or cloud storage.' });
    }

    if (order.status === 'Completed') {
      return res.status(400).json({ error: 'Order is already completed' });
    }

    // Admin has full authority to approve any order, including previously canceled or expired ones
    await executeOrderApproval(order, order.utr || 'ADMIN_MANUAL');

    try { require('../cache').clear(); } catch (_) {}
    return res.json({
      success: true,
      message: 'Order approved successfully! Balances, profits, and team commissions updated.',
      orderStatus: 'Completed'
    });

  } catch (err) {
    console.error('[adminApproveOrder Error]:', err);
    return res.status(500).json({ error: 'Internal Server Error: ' + err.message });
  }
};

exports.processAutoApproval = async (orderId, txnId) => {
  if (!orderId) return false;
  const order = await query.get('SELECT * FROM orders WHERE order_id = ?', [orderId]);

  if (!order || order.status !== 'Confirming') return false;
  await executeOrderApproval(order, txnId || 'WINPEY_AUTO');
  return true;
};

exports.adminCancelOrder = async (req, res) => {
  const { orderId } = req.params;

  try {
    const order = await query.get('SELECT * FROM orders WHERE order_id = ?', [orderId]);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.status === 'Completed') {
      return res.status(400).json({ error: 'Cannot cancel an order that is already Completed' });
    }
    if (order.status === 'Canceled') {
      return res.status(400).json({ error: 'Order has already been canceled' });
    }

    await query.run('UPDATE orders SET status = "Canceled" WHERE order_id = ?', [orderId]);

    const { dbData, saveDb } = require('../db');
    const dbOrder = (dbData.orders || []).find(o => o.order_id === orderId);
    if (dbOrder) {
      dbOrder.status = 'Canceled';
      dbOrder.cancel_reason = 'Admin Manual Reject';
      dbOrder.is_auto_rejected = false;
      saveDb();
      persistToSupabase('orders', dbOrder, 'update', 'order_id');
    }

    if (order.withdrawal_id) {
      const w = await query.get('SELECT * FROM withdrawals WHERE id = ?', [order.withdrawal_id]);
      if (w) {
        await query.run('UPDATE withdrawals SET amount_pending = amount_pending + ? WHERE id = ?', [order.amount, order.withdrawal_id]);
      }
    }

    try { require('../cache').clear(); } catch (_) {}
    return res.json({
      success: true,
      message: 'Order rejected successfully by Admin!',
      orderStatus: 'Canceled',
      cancelReason: 'Admin Manual Reject'
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

exports.checkOrderStatus = async (req, res) => {
  const { orderId } = req.body;
  if (!orderId) {
    return res.status(400).json({ error: 'Please provide orderId' });
  }

  try {
    const order = await query.get('SELECT * FROM orders WHERE order_id = ?', [orderId]);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.status === 'Completed') {
      return res.json({ success: true, status: 'Completed', message: 'Order already completed!' });
    }

    // Active query status directly from WinPay API
    console.log(`[StatusCheck] Querying WinPay API for order ${orderId}...`);
    try {
      const queryResult = await winpeyQueryPayment(orderId);
      console.log('[StatusCheck] WinPay query response:', JSON.stringify(queryResult));
      
      const resData = queryResult.data || queryResult.result || queryResult;
      const rawStatus = String(resData.status || resData.payStatus || resData.orderStatus || resData.state || resData.code || '').toUpperCase();
      
      const isSuccess = ['SUCCESS', 'PAID', 'COMPLETED', '1', '200', '0000', 'TRUE'].includes(rawStatus);

      if (isSuccess) {
        await executeOrderApproval(order, resData.order_id || resData.pay_order_id || 'WINPEY_QUERY');
        return res.json({ success: true, status: 'Completed', message: 'Order approved successfully!' });
      }
    } catch (apiErr) {
      console.warn('[StatusCheck] WinPay query failed, checking by latest fallback:', apiErr.message);
    }

    return res.json({ success: true, status: order.status, message: 'Order is still processing.' });
  } catch (err) {
    console.error('[StatusCheck] Error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

exports.winpeyCreatePayout = async (payoutId, amount, bank, phone) => {
  const apiKey = "488b923c-2b03-465e-b9df-55d018124e0c";
  const apiSecret = "fc4a56a2439f47c19213c747ee5693c6";

  return new Promise((resolve, reject) => {
    let holderName = String(bank.account_holder).trim();
    // Auto-correct spelling typo for Ratanjali Biswal to match successful historical transfers
    if (holderName.toLowerCase().replace(/\s+/g, '') === 'ratanjalibiswal' || holderName.toLowerCase().replace(/\s+/g, '') === 'ritanjlibiswal') {
      holderName = 'ritanjali biswal';
    }

    // 1. Build initial parameters dictionary based on API specifications
    const rawParams = {
      merchant_order_id: String(payoutId),
      amount: Number(amount),
      account_name: holderName,
      account_number: String(bank.account_number).trim(),
      ifsc_code: String(bank.ifsc_code).trim(),
      notify_url: 'http://localhost:5000/api/payment/payout-callback',
      currency: 'INR',
      ext: 'payment'
    };

    // 2. Filter out None, empty strings, and case-insensitive 'none' or 'null' text
    const validParams = {};
    for (const [k, v] of Object.entries(rawParams)) {
      if (v === null || v === undefined) continue;
      
      let vStr = String(v).trim();
      if (vStr === '' || vStr.toLowerCase() === 'none' || vStr.toLowerCase() === 'null') {
        continue;
      }
      
      if (typeof v === 'boolean') {
        vStr = v ? 'true' : 'false';
      }
      
      validParams[k] = vStr;
    }

    // 3. Sort keys alphabetically (ASCII ascending)
    const sortedKeys = Object.keys(validParams).sort();
    
    // 4. Join key=value separated by &
    const joined = sortedKeys.map(k => `${k}=${validParams[k]}`).join('&');
    
    // 5. Append secret key at the end of the query string
    const stringToSign = `${joined}&key=${apiSecret}`;
    
    // 6. Compute SHA256 hash in lowercase hex
    const signature = crypto.createHash('sha256').update(stringToSign).digest('hex').toLowerCase();
    
    // 7. Assemble final payload, keeping amount as numeric
    const payload = {
      ...validParams,
      sign: signature
    };
    payload.amount = Number(payload.amount); // Ensure amount remains numeric type in JSON body

    const dataString = JSON.stringify(payload);

    const options = {
      hostname: 'winpey.us.cc',
      port: 443,
      path: '/api/v1/payout/create',
      method: 'POST',
      headers: {
        'X-Api-Key': apiKey,
        'X-Api-Secret': apiSecret,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(dataString)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve(parsed);
        } catch (e) {
          reject(new Error(`Failed to parse payout response: ${body}`));
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.write(dataString);
    req.end();
  });
};

