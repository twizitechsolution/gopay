const { query, dbData, idTrackers, saveDb, loadDb, persistToDb } = require('../db');

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

// In-memory active quotes map
const activeQuotes = new Map();
exports.activeQuotes = activeQuotes;

// Strict P2P Seller Matcher:
// 1. Prioritize registered users with Tcoin wallet balance (bcoin_balance / tcoin_balance) >= amount
// 2. User MUST have active bank details (account_number + bank_name)
// 3. Buyer strictly cannot match with their own account
// 4. Exclude blocked users
// 5. Exclude sellers with active pending orders (Pending, Confirming, Admin Review, Disputed)
// 6. Fair randomization across all eligible sellers and their bank accounts
// 7. Returns null ONLY if no eligible user with sufficient balance & bank details is found
async function findEligibleP2PSeller(buyerUserId, amount) {
  const amtNum = Number(amount);
  const { isMysqlConnected, queryMysql } = require('../mysql');

  if (isMysqlConnected()) {
    try {
      const sql = `
        SELECT u.id, u.uid, u.username, u.mobile, u.bcoin_balance, u.tcoin_balance,
               b.id as bank_id, b.account_holder, b.bank_name, b.account_number, b.ifsc_code, b.upi_id
        FROM users u
        INNER JOIN bank_accounts b ON b.user_id = u.id 
          AND (b.status = 'Active' OR b.status IS NULL)
          AND b.account_number IS NOT NULL AND TRIM(b.account_number) != ''
          AND b.bank_name IS NOT NULL AND TRIM(b.bank_name) != ''
        WHERE u.id != ?
          AND (u.is_blocked = 0 OR u.is_blocked IS NULL)
          AND (COALESCE(u.bcoin_balance, 0) >= ? OR COALESCE(u.tcoin_balance, 0) >= ?)
          AND u.id NOT IN (
            SELECT DISTINCT seller_id FROM orders 
            WHERE seller_id IS NOT NULL 
              AND status IN ('Pending', 'Confirming', 'Admin Review', 'Disputed')
            UNION
            SELECT DISTINCT receiver_id FROM orders 
            WHERE receiver_id IS NOT NULL 
              AND status IN ('Pending', 'Confirming', 'Admin Review', 'Disputed')
          )
      `;
      const rows = await queryMysql(sql, [buyerUserId, amtNum, amtNum]);
      if (rows && rows.length > 0) {
        const sellerMap = new Map();
        for (const row of rows) {
          if (!sellerMap.has(row.id)) {
            sellerMap.set(row.id, {
              id: row.id,
              uid: row.uid,
              username: row.username,
              mobile: row.mobile,
              banks: []
            });
          }
          sellerMap.get(row.id).banks.push({
            id: row.bank_id,
            account_holder: row.account_holder,
            bank_name: row.bank_name,
            account_number: row.account_number,
            ifsc_code: row.ifsc_code,
            upi_id: row.upi_id
          });
        }

        const eligibleList = Array.from(sellerMap.values());
        const selectedSeller = eligibleList[Math.floor(Math.random() * eligibleList.length)];
        const selectedBank = selectedSeller.banks[Math.floor(Math.random() * selectedSeller.banks.length)];

        const fallbackUpi = selectedSeller.mobile ? selectedSeller.mobile + '@upi' : 'merchant@upi';
        return {
          sellerId: selectedSeller.id,
          receiverDetails: {
            receiver_name: selectedBank.account_holder || selectedSeller.username || 'P2P Seller',
            bank_name: selectedBank.bank_name,
            account_number: selectedBank.account_number,
            ifsc_code: selectedBank.ifsc_code || 'N/A',
            upi_id: selectedBank.upi_id || fallbackUpi,
            mobile: selectedSeller.mobile || 'N/A',
            user_id: selectedSeller.id,
            uid: selectedSeller.uid || 'N/A'
          }
        };
      }
    } catch (err) {
      console.error('[P2P Matcher] MySQL query error:', err.message);
    }
  }

  // In-memory fallback (strictly filtered with zero orphan banks)
  loadDb();
  const allUsers = (dbData.users || []).filter(u => Number(u.id) !== Number(buyerUserId) && !u.is_blocked);
  const validUserIds = new Set(allUsers.map(u => Number(u.id)));
  const allBanks = (dbData.bank_accounts || []).filter(b => 
    validUserIds.has(Number(b.user_id)) && 
    (b.status === 'Active' || !b.status) &&
    b.account_number && b.bank_name
  );
  const allOrders = dbData.orders || [];

  const eligibleSellers = allUsers.filter(seller => {
    const sellerBal = Number(seller.bcoin_balance || seller.tcoin_balance || 0);
    if (sellerBal < amtNum) return false;

    const sellerBanks = allBanks.filter(b => Number(b.user_id) === Number(seller.id));
    if (sellerBanks.length === 0) return false;

    const hasPendingOrder = allOrders.some(o => 
      (Number(o.seller_id) === Number(seller.id) || Number(o.receiver_id) === Number(seller.id)) &&
      ['Pending', 'Confirming', 'Admin Review', 'Disputed'].includes(o.status)
    );
    if (hasPendingOrder) return false;

    return true;
  });

  if (eligibleSellers.length > 0) {
    const selectedSeller = eligibleSellers[Math.floor(Math.random() * eligibleSellers.length)];
    const sellerBanks = allBanks.filter(b => Number(b.user_id) === Number(selectedSeller.id));
    const selectedBank = sellerBanks[Math.floor(Math.random() * sellerBanks.length)];
    const fallbackUpi = selectedSeller.mobile ? selectedSeller.mobile + '@upi' : 'merchant@upi';

    return {
      sellerId: selectedSeller.id,
      receiverDetails: {
        receiver_name: selectedBank.account_holder || selectedSeller.username || 'P2P Seller',
        bank_name: selectedBank.bank_name,
        account_number: selectedBank.account_number,
        ifsc_code: selectedBank.ifsc_code || 'N/A',
        upi_id: selectedBank.upi_id || fallbackUpi,
        mobile: selectedSeller.mobile || 'N/A',
        user_id: selectedSeller.id,
        uid: selectedSeller.uid || 'N/A'
      }
    };
  }

  return null;
}

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
    const { isMysqlConnected, fetchOneFromMysql } = require('../mysql');
    if (isMysqlConnected()) {
      const row = await fetchOneFromMysql('settings', 'key', 'config');
      if (row && row.value) {
        const val = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
        dbData.settings = { ...(dbData.settings || {}), ...val };
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
      timerExpiry = new Date(Date.now() + 15 * 60 * 1000).toISOString();

      // Find eligible P2P seller strictly (prioritize real users with Tcoin balance & active bank):
      const matched = await findEligibleP2PSeller(userId, amtNum);

      if (matched && matched.receiverDetails) {
        receiverId = matched.sellerId;
        receiverDetails = matched.receiverDetails;
      } else {
        // Fallback to Official Merchant ONLY when no eligible user has sufficient balance or active bank account
        receiverId = null;
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

    // Also persist quote immediately to MySQL
    try {
      const { isMysqlConnected, persistToMysql } = require('../mysql');
      if (isMysqlConnected()) {
        await persistToMysql('orders', {
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
        }, 'upsert', 'order_id');
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
  if (!cleanUtr || cleanUtr.toUpperCase() === 'NOT_SUBMITTED') {
    return exports.getPaymentQuote(req, res);
  }

  // Strict 12-digit numeric UTR Validation
  if (!/^\d{12}$/.test(cleanUtr)) {
    return res.status(400).json({ error: 'Please enter a valid 12-digit numeric UTR number.' });
  }

  // Mandatory Payment Screenshot Validation
  if (!screenshot || typeof screenshot !== 'string' || screenshot.trim().length < 50) {
    return res.status(400).json({ error: 'Payment screenshot is mandatory. Please upload payment proof.' });
  }

  
  let cachedQuote = null;
  if (orderId && activeQuotes.has(orderId)) {
    cachedQuote = activeQuotes.get(orderId);
  }
  if (!cachedQuote && orderId) {
    try {
      const { isMysqlConnected, fetchOneFromMysql } = require('../mysql');
      if (isMysqlConnected()) {
        const dbQuote = await fetchOneFromMysql('orders', 'order_id', orderId);
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
    const { isMysqlConnected, fetchOneFromMysql } = require('../mysql');
    if (isMysqlConnected()) {
      const row = await fetchOneFromMysql('settings', 'key', 'config');
      if (row && row.value) {
        const val = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
        dbData.settings = { ...(dbData.settings || {}), ...val };
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
    const finalReceiverId = receiver_id || (cachedQuote && cachedQuote.receiverId) || null;

    // Build receiver details
    let receiverDetails = cachedQuote && cachedQuote.receiverDetails ? cachedQuote.receiverDetails : null;
    if (!receiverDetails && finalReceiverId) {
      let bank = null;
      let receiverUser = null;
      try {
        const { isMysqlConnected, fetchOneFromMysql, queryMysql } = require('../mysql');
        if (isMysqlConnected()) {
          receiverUser = await fetchOneFromMysql('users', 'id', finalReceiverId);
          const bankRows = await queryMysql('SELECT * FROM bank_accounts WHERE user_id = ? AND (status = "Active" OR status IS NULL) AND account_number IS NOT NULL AND TRIM(account_number) != "" LIMIT 1', [finalReceiverId]);
          bank = bankRows && bankRows.length > 0 ? bankRows[0] : null;
        }
      } catch (_) {}
      if (!receiverUser) receiverUser = (dbData.users || []).find(u => Number(u.id) === Number(finalReceiverId));
      if (!bank) bank = (dbData.bank_accounts || []).find(b => Number(b.user_id) === Number(finalReceiverId) && (b.status === 'Active' || !b.status));

      if (bank && receiverUser) {
        receiverDetails = {
          receiver_name: bank.account_holder || receiverUser.username || 'P2P Seller',
          bank_name: bank.bank_name || 'Bank',
          account_number: bank.account_number || 'N/A',
          ifsc_code: bank.ifsc_code || 'N/A',
          upi_id: bank.upi_id || (receiverUser.mobile ? `${receiverUser.mobile}@upi` : 'merchant@upi'),
          mobile: receiverUser.mobile || 'N/A',
          user_id: receiverUser.id,
          uid: receiverUser.uid || 'N/A'
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

    try {
      await query.run(`
        INSERT INTO orders (order_id, user_id, seller_id, asset_type, amount, expected_income, quota, status, utr, screenshot_path)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'Confirming', ?, ?)
      `, [orderId, userId, finalReceiverId, assetType, amtNum, expectedIncome, quota, cleanUtr, screenshotPath]);
    } catch (_) {
      try {
        await query.run(`
          INSERT INTO orders (order_id, user_id, asset_type, amount, expected_income, quota, status, utr)
          VALUES (?, ?, ?, ?, ?, ?, 'Confirming', ?)
        `, [orderId, userId, assetType, amtNum, expectedIncome, quota, cleanUtr]);
      } catch (err2) {}
    }

    loadDb();
    let order = dbData.orders.find(o => o.order_id === orderId);
    if (!order) {
      order = {
        order_id: orderId,
        user_id: userId,
        seller_id: finalReceiverId,
        receiver_id: finalReceiverId,
        asset_type: assetType,
        amount: amtNum,
        expected_income: expectedIncome,
        quota: quota,
        status: 'Confirming',
        utr: cleanUtr,
        screenshot_path: screenshotPath,
        receiver_details: receiverDetails,
        timer_expiry: timerExpiry,
        created_at: new Date().toISOString()
      };
      dbData.orders.push(order);
    } else {
      order.seller_id = finalReceiverId;
      order.receiver_id = finalReceiverId;
      order.timer_expiry = timerExpiry;
      order.receiver_details = receiverDetails;
      if (screenshotPath) order.screenshot_path = screenshotPath;
    }

    if (withdrawal_id) {
      const w = dbData.withdrawals.find(x => x.id == withdrawal_id);
      if (w) {
        order.withdrawal_id = w.id;
        w.amount_pending = Math.max(0, w.amount_pending - amtNum);
      }
    }
    activeQuotes.delete(orderId);
    saveDb();
    persistToDb('orders', order, 'update', 'order_id');
    if (withdrawal_id) {
      const w = dbData.withdrawals.find(x => x.id == withdrawal_id);
      if (w) persistToDb('withdrawals', w, 'update', 'id');
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
  const { isMysqlConnected, fetchOneFromMysql, persistToMysql } = require('../mysql');

  
  let currentOrder = await query.get('SELECT * FROM orders WHERE order_id = ?', [order.order_id]);
  if (!currentOrder && isMysqlConnected()) {
    try {
      const suO = await fetchOneFromMysql('orders', 'order_id', order.order_id);
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

  // Update order status to Completed in MySQL
  try {
    const { isMysqlConnected, persistToMysql } = require('../mysql');
    if (isMysqlConnected()) {
      await persistToMysql('orders', { order_id: order.order_id, status: 'Completed' }, 'update', 'order_id');
    }
  } catch (e) {
    console.warn('[executeOrderApproval] MySQL order update warning:', e.message);
  }

  // 1c. ONLY if matched to an ACTUAL P2P seller (receiver_id > 1)
  const linkedWithdrawalId = order.withdrawal_id || (dbOrder ? dbOrder.withdrawal_id : null);
  const receiverId = order.receiver_id || (dbOrder ? dbOrder.receiver_id : null);
  if (receiverId && receiverId != 1) {
    let seller = (dbData.users || []).find(u => u.id == receiverId);
    if (!seller && isMysqlConnected()) {
      try {
        const suSeller = await fetchOneFromMysql('users', 'id', receiverId);
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
      persistToDb('transactions', withdrawTx, 'upsert', 'id');
      persistToDb('users', seller, 'update', 'id');
      if (w) persistToDb('withdrawals', w, 'update', 'id');
    }
  }

  // 2. Fetch the user who placed this order (buyer)
  let buyer = await query.get('SELECT * FROM users WHERE id = ?', [order.user_id]);
  if (!buyer && isMysqlConnected()) {
    try {
      const suBuyer = await fetchOneFromMysql('users', 'id', order.user_id);
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

  try {
    const { isMysqlConnected, persistToMysql } = require('../mysql');
    if (isMysqlConnected()) {
      await persistToMysql('users', buyer, 'update', 'id');
    }
  } catch (e) {}

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
  persistToDb('transactions', depTx, 'upsert', 'id');

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
  persistToDb('transactions', bonusTx, 'upsert', 'id');
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
    if (!parent && isMysqlConnected()) {
      try {
        const suParent = await fetchOneFromMysql('users', 'id', currentParentId);
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

      if (isMysqlConnected()) {
        try {
          await persistToMysql('users', {
            id: parent.id,
            inr_balance: Number(parent.inr_balance || 0),
            bcoin_balance: newParentBcoinBalance,
            total_earnings: newParentTotalEarnings,
            today_profit: newParentTodayProfit
          }, 'update', 'id');
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
      persistToDb('transactions', commTx, 'upsert', 'id');
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
    const { isMysqlConnected, fetchOneFromMysql } = require('../mysql');
    if (isMysqlConnected()) {
      try {
        const suO = await fetchOneFromMysql('orders', 'order_id', orderId);
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
      persistToDb('orders', dbOrder, 'update', 'order_id');
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

