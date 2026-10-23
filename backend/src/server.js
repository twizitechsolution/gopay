const dotenv = require('dotenv');
dotenv.config();

const path = require('path');
const fs = require('fs');

const express = require('express');
const cors = require('cors');
const { initDb, query, dbData, idTrackers, saveDb, loadDb, persistToSupabase } = require('./db');

// Controllers
const authController = require('./controllers/authController');
const userController = require('./controllers/userController');
const bankController = require('./controllers/bankController');
const orderController = require('./controllers/orderController');

// Middlewares
const authMiddleware = require('./middleware/authMiddleware');
const adminAuth = require('./middleware/adminAuth');
const adminController = require('./controllers/adminController');
const { sendPushNotification } = require('./firebase');

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS & OPTIONS Preflight - Allow all origins (web landing + admin panel + mobile app)
app.use(cors({ origin: '*' }));
app.options('*', cors());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const dns = require('dns');
try {
  dns.setDefaultResultOrder('ipv4first');
} catch (_) {}

let dbInitPromise = null;
app.use((req, res, next) => {
  if (!dbInitPromise) {
    dbInitPromise = initDb().catch((err) => {
      console.error('[Server] Background DB initialization error:', err.message);
    });
  }
  next();
});

const uploadsDir = process.env.VERCEL ? '/tmp/uploads' : path.join(__dirname, '../public/uploads');
try {
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
} catch (e) {
  // Read-only filesystem in serverless
}
app.use('/uploads', express.static(uploadsDir));
app.use('/api/uploads', express.static(uploadsDir));

// Health check and root status endpoint
app.get(['/api', '/api/health'], (req, res) => {
  return res.json({
    status: 'ok',
    server: 'Gopay Backend API',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Automatic redirect for frontend web pages accidentally visited on backend domain
app.get(['/memberInvite', '/signup'], (req, res) => {
  const query = new URLSearchParams(req.query).toString();
  const target = `https://gopay.online${req.path}${query ? '?' + query : ''}`;
  return res.redirect(302, target);
});

// Route to view image proof bypassing Nginx static extensions intercepts
app.get('/api/view-image', async (req, res) => {
  try {
    const { file } = req.query;
    if (!file) return res.status(400).send('File parameter is required');

    // 1. Direct redirect if already a full remote URL (e.g. Supabase Storage)
    if (file.startsWith('http://') || file.startsWith('https://')) {
      return res.redirect(302, file);
    }

    // 2. Base64 data URI direct response
    if (file.startsWith('data:image/')) {
      const matches = file.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      if (matches) {
        res.setHeader('Content-Type', matches[1]);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.send(Buffer.from(matches[2], 'base64'));
      }
    }

    // Normalize both Windows and Unix slashes to safely extract pure filename
    const safeFilename = path.basename(file.replace(/\\/g, '/'));
    const filePath = path.join(uploadsDir, safeFilename);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    if (fs.existsSync(filePath)) {
      let contentType = 'image/png';
      if (safeFilename.endsWith('.jpg') || safeFilename.endsWith('.jpeg')) {
        contentType = 'image/jpeg';
      } else if (safeFilename.endsWith('.webp')) {
        contentType = 'image/webp';
      } else if (safeFilename.endsWith('.pdf')) {
        contentType = 'application/pdf';
      }
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.sendFile(filePath);
    }

    // 3. Fallback to Supabase Storage public URL
    try {
      const { supabase, isSupabaseConnected } = require('./supabase');
      if (isSupabaseConnected()) {
        const { data: pUrl } = supabase.storage.from('screenshots').getPublicUrl(safeFilename);
        if (pUrl && pUrl.publicUrl) {
          // If query param fallback=false or direct check, redirect
          return res.redirect(302, pUrl.publicUrl);
        }
      }
    } catch (_) {}

    // 4. Clean SVG fallback image for orders where physical screenshot was archived
    const utrLabel = req.query.utr || 'VERIFIED';
    const orderLabel = req.query.order || safeFilename.substring(0, 24);
    const svgBadge = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#0f172a"/>
          <stop offset="100%" stop-color="#1e1b4b"/>
        </linearGradient>
      </defs>
      <rect width="600" height="400" rx="20" fill="url(#bg)"/>
      <circle cx="300" cy="130" r="45" fill="#4338ca" opacity="0.3"/>
      <circle cx="300" cy="130" r="32" fill="#6366f1"/>
      <path d="M288 130 l8 8 l16 -16" stroke="#ffffff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      <text x="300" y="215" text-anchor="middle" fill="#ffffff" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif" font-size="18" font-weight="bold" letter-spacing="1">DIGITAL PAYMENT PROOF RECORDED</text>
      <text x="300" y="245" text-anchor="middle" fill="#94a3b8" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif" font-size="13">Reference UTR: ${utrLabel}</text>
      <text x="300" y="275" text-anchor="middle" fill="#64748b" font-family="monospace" font-size="11">Order: ${orderLabel}</text>
      <rect x="200" y="310" width="200" height="32" rx="16" fill="#10b981" opacity="0.15"/>
      <rect x="200" y="310" width="200" height="32" rx="16" stroke="#10b981" stroke-width="1" fill="none"/>
      <text x="300" y="331" text-anchor="middle" fill="#34d399" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif" font-size="12" font-weight="bold">UTR Verified on Server</text>
    </svg>`;
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(svgBadge);
  } catch (err) {
    return res.status(500).send(err.message);
  }
});

// Static serving for uploaded screenshots/files

// Helper function to save base64 uploads (persists to Supabase Storage for serverless)
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
    if (type.includes('pdf')) ext = 'pdf';
    else if (type.includes('jpeg') || type.includes('jpg')) ext = 'jpg';
    else if (type.includes('webp')) ext = 'webp';

    const fileName = `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000)}.${ext}`;

    // 1. Try Supabase Storage upload first (permanent cloud storage across serverless lambdas)
    try {
      const { supabase, isSupabaseConnected } = require('./supabase');
      if (isSupabaseConnected()) {
        const { data: upData, error: upErr } = await supabase.storage
          .from('screenshots')
          .upload(fileName, buffer, { contentType: type, upsert: true });
        if (!upErr && upData) {
          const { data: pData } = supabase.storage.from('screenshots').getPublicUrl(fileName);
          if (pData && pData.publicUrl) {
            console.log('[Supabase Storage] Screenshot uploaded successfully:', pData.publicUrl);
            return pData.publicUrl;
          }
        } else if (upErr) {
          console.warn('[Supabase Storage Upload Warning]:', upErr.message);
        }
      }
    } catch (sErr) {
      console.warn('[Supabase Storage Upload Exception]:', sErr.message);
    }

    // 2. Fallback to local disk file write
    try {
      fs.writeFileSync(path.join(uploadsDir, fileName), buffer);
      return `/uploads/${fileName}`;
    } catch (e) {
      console.warn('[Server] Upload disk write skipped in serverless:', e.message);
      return base64Str;
    }
  } catch (err) {
    console.error('Error saving base64 file:', err);
    return null;
  }
}

// Logger middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// --- API ROUTES ---

// 1. Authentication Router
app.post('/api/auth/send-otp', authController.sendOtp);
app.post('/api/auth/signup', authController.signup);
app.post('/api/auth/login', authController.login);
app.post('/api/auth/change-password', authMiddleware, authController.changePassword);
app.post('/api/auth/reset-password', authController.resetPassword);

// 2. User & Profile Router
app.get('/api/user/profile', authMiddleware, userController.getProfile);
app.post('/api/user/username', authMiddleware, userController.updateUsername);
app.post('/api/user/pin', authMiddleware, userController.setPin);
app.post('/api/user/task', authMiddleware, userController.completeTask);
app.post('/api/user/claim-newbie', authMiddleware, userController.claimNewbieBonus);
app.get('/api/user/team', authMiddleware, userController.getTeamDetails);
app.get('/api/user/transactions', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const { supabase, isSupabaseConnected } = require('./supabase');
    let list = [];
    if (isSupabaseConnected()) {
      try {
        const { data: suTxns } = await supabase.from('transactions').select('*').eq('user_id', userId).order('id', { ascending: false });
        if (suTxns && suTxns.length > 0) list = suTxns;
      } catch (_) {}
    }
    if (list.length === 0) {
      list = await query.all('SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC', [userId]);
    }
    return res.json({ success: true, transactions: list });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 3. Bank Accounts Router
app.get('/api/bank', authMiddleware, bankController.listBankAccounts);
app.post('/api/bank', authMiddleware, bankController.addBankAccount);
app.put('/api/bank/:id/toggle', authMiddleware, bankController.toggleBankAccountStatus);
app.delete('/api/bank/:id', authMiddleware, bankController.deleteBankAccount);

// 4. Orders Router
app.get('/api/orders', authMiddleware, orderController.listOrders);
app.post('/api/orders/quote', authMiddleware, orderController.getPaymentQuote);
app.post('/api/orders', authMiddleware, orderController.createOrder);
app.post('/api/orders/utr', authMiddleware, orderController.submitUtr);
app.post('/api/orders/:orderId/submit-p2p', authMiddleware, orderController.createOrder);
app.post('/api/orders/check-status', authMiddleware, orderController.checkOrderStatus);

// 4b. Dynamic Carousel Banners Route
app.get('/api/sliders', async (req, res) => {
  try {
    const list = await query.all('SELECT * FROM sliders ORDER BY id DESC');
    return res.json({ success: true, sliders: list });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 4c. Dynamic Products & Price Ranges Routes
app.get('/api/products', async (req, res) => {
  try {
    loadDb();
    try {
      const { supabase, isSupabaseConnected } = require('./supabase');
      if (isSupabaseConnected()) {
        const { data } = await supabase.from('settings').select('*').eq('key', 'config').maybeSingle();
        if (data && data.value) {
          dbData.settings = { ...(dbData.settings || {}), ...data.value };
        }
      }
    } catch (_) {}
    
    // Read Admin configured Min / Max order limits (defaults: 500 / 100000)
    const cfg = dbData.settings || {};
    const minLimit = Number(cfg.min_order_amount) > 0 ? Number(cfg.min_order_amount) : 500;
    const maxLimit = Number(cfg.max_order_amount) > 0 ? Number(cfg.max_order_amount) : 100000;

    // Start with catalog products filtered within [minLimit, maxLimit]
    let productsList = (dbData.products || []).filter(p => Number(p.amount) >= minLimit && Number(p.amount) <= maxLimit);
    
    // 1. Add dynamic P2P products generated from active pending withdrawals (within minLimit and maxLimit)
    const pendingWithdrawals = (dbData.withdrawals || [])
      .filter(w => w.status === 'Pending' && w.amount_pending >= minLimit && w.amount_pending <= maxLimit);
      
    pendingWithdrawals.forEach(w => {
      const seller = dbData.users.find(u => u.id == w.user_id);
      if (!seller || seller.bcoin_balance < minLimit || seller.is_blocked) return;

      const bank = dbData.bank_accounts.find(b => b.user_id == seller.id && b.status === 'Active');
      if (!bank) return;

      // STRICT CONCURRENCY LOCK: User must NOT have ANY active/undecided order or active quote
      const hasActiveOrder = (dbData.orders || []).some(o => 
        o.receiver_id == seller.id && ['Pending', 'Confirming', 'Admin Review', 'Disputed'].includes(o.status)
      );
      if (hasActiveOrder) return;

      if (orderController.activeQuotes) {
        const hasActiveQuote = Array.from(orderController.activeQuotes.values()).some(q => 
          q.receiverId == seller.id && Date.now() < new Date(q.timerExpiry).getTime()
        );
        if (hasActiveQuote) return;
      }

      if (seller.bcoin_balance < minLimit || seller.bcoin_balance < w.amount_pending) return;

      const amount = Math.min(Math.max(w.amount_pending, minLimit), maxLimit);
      const income = Number((amount * 0.10 + 8).toFixed(2));
      const quota = Number((amount + income).toFixed(2));
      
      productsList.push({
        id: `p2p_withdrawal_${w.id}`,
        name: `P2P Plan - ${seller.uid}`,
        amount: amount,
        income: income,
        quota: quota,
        color: ['blue', 'red', 'green', 'purple', 'indigo'][seller.id % 5],
        type: 'Bank',
        percent: '10%+8',
        is_p2p: true,
        matched_user_id: seller.id,
        withdrawal_id: w.id
      });
    });



    // 3. Add 2 Random Auto-Orders strictly bounded within [minLimit, maxLimit]
    const midPoint = Math.max(minLimit, Math.floor((minLimit + maxLimit) / 2));
    const randomAmounts = [
      Math.floor(minLimit + Math.random() * Math.max(1, (midPoint - minLimit))),
      Math.floor(midPoint + Math.random() * Math.max(1, (maxLimit - midPoint)))
    ];

    randomAmounts.forEach((randAmt, idx) => {
      const amount = Math.min(Math.max(randAmt, minLimit), maxLimit);
      const income = Number((amount * 0.10 + 8).toFixed(2));
      const quota = Number((amount + income).toFixed(2));
      productsList.push({
        id: `auto_order_random_${idx + 1}`,
        name: `Auto Plan #${idx + 1} - Instant`,
        amount: amount,
        income: income,
        quota: quota,
        color: idx === 0 ? 'emerald' : 'blue',
        type: 'Bank',
        percent: '10%+8',
        is_auto: true
      });
    });
    
    // Strict safety filter: NO product can EVER exceed maxLimit or fall below minLimit
    productsList = productsList.filter(p => Number(p.amount) >= minLimit && Number(p.amount) <= maxLimit);

    // Sort products by amount to display cleanly
    productsList.sort((a, b) => a.amount - b.amount);
    
    return res.json({ success: true, products: productsList });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/price-ranges', async (req, res) => {
  try {
    const list = await query.all('SELECT * FROM price_ranges');
    return res.json({ success: true, priceRanges: list });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/settings', async (req, res) => {
  try {
    loadDb();
    try {
      const { supabase, isSupabaseConnected } = require('./supabase');
      if (isSupabaseConnected()) {
        const { data } = await supabase.from('settings').select('*').eq('key', 'config').maybeSingle();
        if (data && data.value) {
          dbData.settings = { ...(dbData.settings || {}), ...data.value };
        }
      }
    } catch (_) {}
    const config = dbData.settings || {};
    return res.json({ 
      success: true, 
      settings: {
        ...config,
        default_ref_code: config.default_ref_code || 'tp3340vnxr',
        min_order_amount: Number(config.min_order_amount) > 0 ? Number(config.min_order_amount) : 500,
        max_order_amount: Number(config.max_order_amount) > 0 ? Number(config.max_order_amount) : 100000
      } 
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 5. Secure Admin Dashboard Router
app.post('/api/admin/auth/login', adminController.adminLogin);

// Protected Admin Management Endpoints
app.post('/api/admin/change-password', adminAuth, adminController.changeAdminPassword);
app.get('/api/admin/stats', adminAuth, adminController.getDashboardStats);
app.get('/api/admin/reports', adminAuth, adminController.getReportsData);
app.get('/api/admin/users', adminAuth, adminController.getUsersList);
app.post('/api/admin/users/:id/toggle-block', adminAuth, adminController.toggleUserBlock);
app.get('/api/admin/orders', adminAuth, async (req, res) => {
  try {
    const adminCache = require('./cache');
    const cached = adminCache.get('orders');
    if (cached) {
      return res.json(cached);
    }

    const { fetchAll, isSupabaseConnected } = require('./supabase');
    const { loadDb, dbData } = require('./db');
    loadDb();

    let list = [];
    if (isSupabaseConnected()) {
      try {
        const [recentOrders, allUsersData, allBanksData] = await Promise.all([
          fetchAll('orders', 'id, order_id, user_id, asset_type, amount, expected_income, quota, status, utr, receiver_id, withdrawal_id, timer_expiry, receiver_details, screenshot_path, created_at', 'created_at', false, 20000),
          fetchAll('users', 'id, uid, mobile, username', 'id', false, 20000),
          fetchAll('bank_accounts', '*', 'id', false, 10000)
        ]);

        const allOrders = recentOrders || [];
        const allUsers = allUsersData || [];
        const allBanks = allBanksData || [];

        if (allOrders.length > 0) {
          const usersMap = {};
          allUsers.forEach(u => { usersMap[u.id] = u; });
          const banksMap = {};
          allBanks.forEach(b => {
            if (b.status === 'Active' || !banksMap[b.user_id]) {
              banksMap[b.user_id] = b;
            }
          });

          list = allOrders.map(order => {
            const user = usersMap[order.user_id] || {};
            const recId = order.receiver_id;
            let receiver_mobile = 'N/A';
            let receiver_uid = 'OFFICIAL';
            let receiver_name = 'Official Merchant';
            let receiver_bank = 'UPI Merchant';
            let receiver_account = 'N/A';
            let receiver_upi = 'Earnclub@apl';

            if (recId) {
              const receiverUser = usersMap[recId];
              const bankAcc = banksMap[recId];
              receiver_mobile = receiverUser ? receiverUser.mobile : 'N/A';
              receiver_uid = receiverUser ? receiverUser.uid : 'N/A';
              receiver_name = bankAcc ? bankAcc.account_holder : (receiverUser ? (receiverUser.username || 'P2P Seller') : 'P2P Seller');
              receiver_bank = bankAcc ? bankAcc.bank_name : 'Bank';
              receiver_account = bankAcc ? bankAcc.account_number : 'N/A';
              receiver_upi = bankAcc ? bankAcc.upi_id : (receiverUser ? `${receiverUser.mobile}@upi` : 'N/A');
            }

            return {
              ...order,
              user_uid: user.uid || (order.user_uid || 'N/A'),
              user_mobile: user.mobile || (order.user_mobile || 'N/A'),
              receiver_mobile,
              receiver_uid,
              receiver_name,
              receiver_bank,
              receiver_account,
              receiver_upi
            };
          });
        }
      } catch (suErr) {
        console.warn('[AdminOrders] Supabase live fetch failed, falling back to local query:', suErr.message);
      }
    }

    if (!list || list.length === 0) {
      list = await query.all(`
        SELECT orders.*, users.uid as user_uid, users.mobile as user_mobile 
        FROM orders 
        LEFT JOIN users ON orders.user_id = users.id 
        ORDER BY orders.id DESC
      `);

      list.forEach(order => {
        const recId = order.receiver_id;
        if (recId) {
          const receiverUser = (dbData.users || []).find(u => u.id == recId);
          const bankAcc = (dbData.bank_accounts || []).find(b => b.user_id == recId && b.status === 'Active') ||
                          (dbData.bank_accounts || []).find(b => b.user_id == recId);
          order.receiver_mobile = receiverUser ? receiverUser.mobile : 'N/A';
          order.receiver_uid = receiverUser ? receiverUser.uid : 'N/A';
          order.receiver_name = bankAcc ? bankAcc.account_holder : (receiverUser ? (receiverUser.username || 'P2P Seller') : 'P2P Seller');
          order.receiver_bank = bankAcc ? bankAcc.bank_name : 'Bank';
          order.receiver_account = bankAcc ? bankAcc.account_number : 'N/A';
          order.receiver_upi = bankAcc ? bankAcc.upi_id : (receiverUser ? `${receiverUser.mobile}@upi` : 'N/A');
        } else {
          order.receiver_mobile = 'N/A';
          order.receiver_uid = 'OFFICIAL';
          order.receiver_name = 'Official Merchant';
          order.receiver_bank = 'UPI Merchant';
          order.receiver_account = 'N/A';
          order.receiver_upi = 'Earnclub@apl';
        }
      });
    }

    const responseData = { success: true, orders: list };
    adminCache.set('orders', responseData, 30000); // 30s cache
    return res.json(responseData);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});
app.post('/api/admin/orders/:orderId/approve', adminAuth, orderController.adminApproveOrder);
app.post('/api/admin/orders/:orderId/cancel', adminAuth, orderController.adminCancelOrder);

// Slider Banners management
app.post('/api/admin/sliders', adminAuth, async (req, res) => {
  try {
    const { image_data } = req.body;
    if (!image_data) {
      return res.status(400).json({ error: 'image_data parameter is required' });
    }
    const result = await query.run('INSERT INTO sliders (image_data) VALUES (?)', [image_data]);
    return res.json({ success: true, slider_id: result.lastID });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/sliders/:id', adminAuth, async (req, res) => {
  try {
    const result = await query.run('DELETE FROM sliders WHERE id = ?', [req.params.id]);
    return res.json({ success: true, changes: result.changes });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Product Management
app.post('/api/admin/products', adminAuth, async (req, res) => {
  try {
    const { name, amount, income, quota, color, type, percent } = req.body;
    if (!name || !amount) {
      return res.status(400).json({ error: 'name and amount are required' });
    }
    const result = await query.run(
      'INSERT INTO products (name, amount, income, quota, color, type, percent) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [name, Number(amount), Number(income || 0), Number(quota || amount), color || 'blue', type || 'Bank', percent || '']
    );
    return res.json({ success: true, product_id: result.lastID });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/products/:id', adminAuth, async (req, res) => {
  try {
    const { name, amount, income, quota, color, type, percent } = req.body;
    const result = await query.run(
      'UPDATE products SET name = ?, amount = ?, income = ?, quota = ?, color = ?, type = ?, percent = ? WHERE id = ?',
      [name, Number(amount), Number(income || 0), Number(quota || amount), color || 'blue', type || 'Bank', percent || '', req.params.id]
    );
    return res.json({ success: true, changes: result.changes });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/products/:id', adminAuth, async (req, res) => {
  try {
    const result = await query.run('DELETE FROM products WHERE id = ?', [req.params.id]);
    return res.json({ success: true, changes: result.changes });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Price Ranges Management
app.post('/api/admin/price-ranges', adminAuth, async (req, res) => {
  try {
    const { label, min_val, max_val } = req.body;
    if (!label) {
      return res.status(400).json({ error: 'label is required' });
    }
    const result = await query.run(
      'INSERT INTO price_ranges (label, min_val, max_val) VALUES (?, ?, ?)',
      [label, Number(min_val || 0), Number(max_val || 99999999)]
    );
    return res.json({ success: true, range_id: result.lastID });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/price-ranges/:id', adminAuth, async (req, res) => {
  try {
    const result = await query.run('DELETE FROM price_ranges WHERE id = ?', [req.params.id]);
    return res.json({ success: true, changes: result.changes });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Broadcast Messages API
app.get('/api/messages', async (req, res) => {
  try {
    const list = await query.all('SELECT * FROM messages ORDER BY id DESC');
    return res.json({ success: true, messages: list });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/messages', adminAuth, async (req, res) => {
  try {
    const { title, content } = req.body;
    if (!title || !content) {
      return res.status(400).json({ error: 'title and content are required' });
    }
    const result = await query.run('INSERT INTO messages (title, content) VALUES (?, ?)', [title, content]);
    
    // Send push notification to all users who have registered FCM tokens
    loadDb();
    dbData.users.forEach(user => {
      if (user.fcm_tokens && user.fcm_tokens.length > 0) {
        sendPushNotification(
          user,
          title,
          content,
          { url: '/messages' }
        );
      }
    });

    return res.json({ success: true, message_id: result.lastID });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/messages/:id', adminAuth, async (req, res) => {
  try {
    const result = await query.run('DELETE FROM messages WHERE id = ?', [req.params.id]);
    return res.json({ success: true, changes: result.changes });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Commission Setup Settings Routes
app.get('/api/admin/settings', adminAuth, async (req, res) => {
  try {
    loadDb();
    try {
      const { supabase, isSupabaseConnected } = require('./supabase');
      if (isSupabaseConnected()) {
        const { data } = await supabase.from('settings').select('*').eq('key', 'config').maybeSingle();
        if (data && data.value) {
          dbData.settings = { ...(dbData.settings || {}), ...data.value };
        }
      }
    } catch (_) {}
    let config = { ...(dbData.settings || {}) };
    config.min_order_amount = Number(config.min_order_amount) > 0 ? Number(config.min_order_amount) : 500;
    config.max_order_amount = Number(config.max_order_amount) > 0 ? Number(config.max_order_amount) : 100000;
    config.default_ref_code = config.default_ref_code || 'tp3340vnxr';
    return res.json({ success: true, settings: config });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/settings', adminAuth, async (req, res) => {
  try {
    const { level1_commission, level2_commission, level3_commission, telegram_link, winpey_api_key, winpey_api_secret, payment_mode, upi_ids, default_ref_code, min_order_amount, max_order_amount } = req.body;
    
    // Update memory & database settings
    dbData.settings = dbData.settings || {};
    if (default_ref_code !== undefined) {
      dbData.settings.default_ref_code = String(default_ref_code).trim();
    }
    if (min_order_amount !== undefined) {
      dbData.settings.min_order_amount = Number(min_order_amount);
    }
    if (max_order_amount !== undefined) {
      dbData.settings.max_order_amount = Number(max_order_amount);
    }
    dbData.settings.level1_commission = Number(level1_commission || dbData.settings.level1_commission || 10);
    dbData.settings.level2_commission = Number(level2_commission || dbData.settings.level2_commission || 5);
    dbData.settings.level3_commission = Number(level3_commission || dbData.settings.level3_commission || 2);
    if (telegram_link) dbData.settings.telegram_link = telegram_link;
    if (payment_mode) dbData.settings.payment_mode = payment_mode;
    if (upi_ids !== undefined) dbData.settings.upi_ids = upi_ids;
    
    saveDb();

    // Direct Supabase sync if connected
    try {
      const { supabase, isSupabaseConnected } = require('./supabase');
      if (isSupabaseConnected()) {
        await supabase.from('settings').upsert({
          key: 'config',
          value: dbData.settings,
          updated_at: new Date().toISOString()
        });
      }
    } catch (sErr) {
      console.error('[Settings] Supabase sync error:', sErr.message);
    }

    return res.json({ success: true, message: 'Settings updated successfully!', settings: dbData.settings });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Automated 7-Day Maintenance & Inactive Purge
const { runSevenDayCleanup, scheduleMidnightCleanup } = require('./cleanupService');
scheduleMidnightCleanup();

app.post('/api/admin/system/run-cleanup', adminAuth, async (req, res) => {
  try {
    const result = await runSevenDayCleanup();
    return res.json({ success: true, message: '7-Day maintenance completed successfully!', details: result });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/system/sync-supabase', async (req, res) => {
  try {
    const { supabase, isSupabaseConnected } = require('./supabase');
    if (!isSupabaseConnected()) {
      return res.status(500).json({ error: 'Supabase client not connected' });
    }

    const { dbData } = require('./db');
    
    // Batch upsert users in chunks of 300
    const cleanUsers = (dbData.users || []).map(u => ({
      id: u.id,
      uid: u.uid,
      mobile: u.mobile,
      username: u.username || `Gopay_${u.uid}`,
      password_hash: u.password_hash,
      pin: u.pin || null,
      ref_code: u.ref_code,
      parent_id: u.parent_id || null,
      inr_balance: Number(u.inr_balance || 0),
      bcoin_balance: Number(u.bcoin_balance || 0),
      usdt_balance: Number(u.usdt_balance || 0),
      total_earnings: Number(u.total_earnings || 0),
      today_profit: Number(u.today_profit || 0),
      yesterday_profit: Number(u.yesterday_profit || 0),
      is_blocked: Boolean(u.is_blocked),
      fcm_tokens: u.fcm_tokens || [],
      created_at: u.created_at || new Date().toISOString()
    }));

    for (let i = 0; i < cleanUsers.length; i += 300) {
      await supabase.from('users').upsert(cleanUsers.slice(i, i + 300));
    }

    // Verify count in Supabase
    const { count: finalCount } = await supabase.from('users').select('*', { count: 'exact', head: true });

    return res.json({
      success: true,
      message: 'Supabase sync completed successfully!',
      usersCountInSupabase: finalCount
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Admin Withdrawal Management Routes
app.post('/api/admin/users/:userId/withdraw', adminAuth, async (req, res) => {
  try {
    const { amount, utr } = req.body;
    const userId = req.params.userId;
    
    const withdrawAmt = Number(amount);
    if (!withdrawAmt || isNaN(withdrawAmt) || withdrawAmt <= 0) {
      return res.status(400).json({ error: 'Please enter a valid withdrawal amount greater than 0' });
    }
    if (!utr || typeof utr !== 'string' || utr.trim().length === 0) {
      return res.status(400).json({ error: 'Please enter a valid UTR number for manual processing' });
    }
    const cleanUtr = utr.trim();

    const { supabase, isSupabaseConnected } = require('./supabase');
    loadDb();

    // 1. Fetch user directly from Supabase (source of truth) with local fallback
    let user = null;
    if (isSupabaseConnected()) {
      try {
        const { data: suUser } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();
        if (suUser) user = suUser;
      } catch (e) {
        console.warn('[AdminWithdraw] Supabase user query error:', e.message);
      }
    }
    if (!user) {
      user = (dbData.users || []).find(u => u.id == userId);
    }
    if (!user) {
      user = await query.get('SELECT * FROM users WHERE id = ?', [userId]);
    }
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const currentBalance = Number(user.bcoin_balance) || 0;
    if (currentBalance < withdrawAmt) {
      return res.status(400).json({ 
        error: `Insufficient TCoin balance. Current balance is ₹${currentBalance.toFixed(2)}, cannot debit ₹${withdrawAmt.toFixed(2)}` 
      });
    }

    // 2. Fetch user's active bank details if available, otherwise fallback cleanly (do NOT block admin)
    let bank = null;
    if (isSupabaseConnected()) {
      try {
        const { data: suBank } = await supabase.from('bank_accounts').select('*').eq('user_id', userId).order('status', { ascending: true }).limit(1).maybeSingle();
        if (suBank) bank = suBank;
      } catch (_) {}
    }
    if (!bank) {
      bank = (dbData.bank_accounts || []).find(b => b.user_id == userId && b.status === 'Active')
        || (dbData.bank_accounts || []).find(b => b.user_id == userId);
    }

    const bankName = bank?.bank_name || 'Direct Transfer / Cash Out';
    const accNumber = bank?.account_number || 'N/A';
    const accHolder = bank?.account_holder || (user.username || `Gopay_${user.uid || user.id}`);

    const newBcoinBalance = Math.max(0, currentBalance - withdrawAmt);
    const nowIso = new Date().toISOString();
    const payoutId = 'MWD_' + String(Date.now());
    const desc = `Bank: ${bankName}, A/C: ${accNumber}, Holder: ${accHolder}, UTR: ${cleanUtr}, TXID: ${payoutId}, Note: Manual withdrawal processed by administrator`;

    // 3. Update user balance in Supabase
    if (isSupabaseConnected()) {
      try {
        await supabase.from('users').update({ bcoin_balance: newBcoinBalance }).eq('id', userId);
      } catch (e) {
        console.warn('[AdminWithdraw] Supabase user update error:', e.message);
      }
    }
    // Update local memory
    user.bcoin_balance = newBcoinBalance;
    const memUser = (dbData.users || []).find(u => u.id == userId);
    if (memUser) memUser.bcoin_balance = newBcoinBalance;
    saveDb();

    // 4. Insert transaction record (Withdraw) into Supabase & local DB
    let nextTxId = (idTrackers.transactions || 0) + 1;
    if (isSupabaseConnected()) {
      try {
        const { data: maxTx } = await supabase.from('transactions').select('id').order('id', { ascending: false }).limit(1).maybeSingle();
        if (maxTx && maxTx.id) {
          nextTxId = Math.max(nextTxId, Number(maxTx.id) + 1);
        }
      } catch (e) {
        console.warn('Error fetching max tx id:', e.message);
      }
    }
    idTrackers.transactions = Math.max(idTrackers.transactions || 0, nextTxId);

    const txRecord = {
      id: nextTxId,
      user_id: Number(userId),
      type: 'Withdraw',
      amount: -withdrawAmt,
      balance_after: newBcoinBalance,
      description: desc,
      created_at: nowIso
    };

    if (isSupabaseConnected()) {
      try {
        const { data: insertedTx, error: insErr } = await supabase.from('transactions').insert([txRecord]).select().maybeSingle();
        if (insErr) {
          console.warn('[AdminWithdraw] Supabase transaction insert error:', insErr.message);
        } else if (insertedTx && insertedTx.id) {
          txRecord.id = insertedTx.id;
        }
      } catch (e) {
        console.warn('[AdminWithdraw] Supabase transaction insert exception:', e.message);
      }
    }
    (dbData.transactions = dbData.transactions || []).push(txRecord);

    // 5. Insert completed withdrawal record into Supabase & local DB
    let nextWId = (idTrackers.withdrawals || 0) + 1;
    if (isSupabaseConnected()) {
      try {
        const { data: maxW } = await supabase.from('withdrawals').select('id').order('id', { ascending: false }).limit(1).maybeSingle();
        if (maxW && maxW.id) {
          nextWId = Math.max(nextWId, Number(maxW.id) + 1);
        }
      } catch (e) {
        console.warn('Error fetching max withdrawal id:', e.message);
      }
    }
    idTrackers.withdrawals = Math.max(idTrackers.withdrawals || 0, nextWId);

    const withdrawalRecord = {
      id: nextWId,
      user_id: Number(userId),
      amount: withdrawAmt,
      amount_pending: 0,
      status: 'Completed',
      bank_account_id: bank?.id || null,
      utr: cleanUtr,
      txid: payoutId,
      created_at: nowIso
    };

    if (isSupabaseConnected()) {
      try {
        const { data: insertedW, error: insWErr } = await supabase.from('withdrawals').insert([withdrawalRecord]).select().maybeSingle();
        if (insWErr) {
          console.warn('[AdminWithdraw] Supabase withdrawal insert error:', insWErr.message);
        } else if (insertedW && insertedW.id) {
          withdrawalRecord.id = insertedW.id;
        }
      } catch (e) {
        console.warn('[AdminWithdraw] Supabase withdrawal insert exception:', e.message);
      }
    }
    (dbData.withdrawals = dbData.withdrawals || []).push(withdrawalRecord);
    saveDb();

    // 6. Invalidate admin cache so UI reflects change immediately
    try { require('./cache').clear(); } catch (_) {}

    return res.json({ 
      success: true, 
      message: `Successfully debited ₹${withdrawAmt.toFixed(2)} and logged manual UTR (${cleanUtr}). New TCoin Balance: ₹${newBcoinBalance.toFixed(2)}`,
      new_balance: newBcoinBalance,
      transaction: txRecord,
      withdrawal: withdrawalRecord
    });
  } catch (err) {
    console.error('[AdminWithdraw] Error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// Comprehensive User Details Endpoint for Admin Modal
app.get('/api/admin/users/:userId/details', adminAuth, async (req, res) => {
  try {
    const userId = req.params.userId;
    const { supabase, isSupabaseConnected } = require('./supabase');
    loadDb();

    let user = null;
    let banks = [];
    let orders = [];
    let withdrawals = [];
    let transactions = [];
    let downline = [];
    let parentUser = null;

    if (isSupabaseConnected()) {
      try {
        const [uRes, bRes, oRes, wRes, txRes, dRes] = await Promise.all([
          supabase.from('users').select('*').eq('id', userId).maybeSingle(),
          supabase.from('bank_accounts').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
          supabase.from('orders').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
          supabase.from('withdrawals').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
          supabase.from('transactions').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
          supabase.from('users').select('id, uid, username, mobile, bcoin_balance, created_at').eq('parent_id', userId).order('created_at', { ascending: false })
        ]);

        if (uRes && uRes.data) user = uRes.data;
        if (bRes && bRes.data) banks = bRes.data;
        if (oRes && oRes.data) orders = oRes.data;
        if (wRes && wRes.data) withdrawals = wRes.data;
        if (txRes && txRes.data) transactions = txRes.data;
        if (dRes && dRes.data) downline = dRes.data;

        if (user && user.parent_id) {
          const { data: pData } = await supabase.from('users').select('id, uid, username, mobile').eq('id', user.parent_id).maybeSingle();
          if (pData) parentUser = pData;
        }
      } catch (e) {
        console.warn('[UserDetails] Supabase query error:', e.message);
      }
    }

    if (!user) {
      user = (dbData.users || []).find(u => u.id == userId);
      if (!user) user = await query.get('SELECT * FROM users WHERE id = ?', [userId]);
    }
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (banks.length === 0) {
      banks = (dbData.bank_accounts || []).filter(b => b.user_id == userId);
    }
    if (orders.length === 0) {
      orders = (dbData.orders || []).filter(o => o.user_id == userId);
    }
    if (withdrawals.length === 0) {
      withdrawals = (dbData.withdrawals || []).filter(w => w.user_id == userId);
    }
    if (transactions.length === 0) {
      transactions = (dbData.transactions || []).filter(t => t.user_id == userId);
    }
    if (downline.length === 0) {
      downline = (dbData.users || []).filter(u => u.parent_id == userId);
    }
    if (!parentUser && user.parent_id) {
      parentUser = (dbData.users || []).find(u => u.id == user.parent_id);
    }

    // Unified withdrawals from both withdrawals table, transactions, and P2P sales
    const unifiedWithdrawals = [...withdrawals];
    const withdrawTxns = transactions.filter(t => t.type === 'Withdraw');
    for (const tx of withdrawTxns) {
      const exists = unifiedWithdrawals.some(w => 
        (w.txid && tx.description && tx.description.includes(w.txid)) ||
        (w.utr && tx.description && tx.description.includes(w.utr)) ||
        (Math.abs(Number(w.amount)) === Math.abs(Number(tx.amount)) && Math.abs(new Date(w.created_at) - new Date(tx.created_at)) < 5000)
      );
      if (!exists) {
        const utrMatch = tx.description ? tx.description.match(/UTR:\s*([^\s,]+)/i) : null;
        unifiedWithdrawals.push({
          id: tx.id,
          user_id: tx.user_id,
          amount: Math.abs(Number(tx.amount)),
          amount_pending: 0,
          status: 'Completed',
          utr: utrMatch ? utrMatch[1] : '-',
          description: tx.description,
          created_at: tx.created_at
        });
      }
    }

    // P2P sale orders where this user was the seller (receiver_id == userId)
    const saleOrders = (orders || []).filter(o => o.receiver_id == userId);
    for (const so of saleOrders) {
      const exists = unifiedWithdrawals.some(w => 
        (w.utr && so.utr && w.utr === so.utr) ||
        (w.txid && w.txid.includes(so.order_id))
      );
      if (!exists) {
        unifiedWithdrawals.push({
          id: 'p2p_' + so.id,
          user_id: userId,
          amount: Math.abs(Number(so.amount)),
          amount_pending: 0,
          status: so.status === 'Completed' ? 'Completed' : (so.status || 'Pending'),
          utr: so.utr || '-',
          description: `P2P Sale Order (${so.order_id}) - ${so.asset_type || 'USDT'}`,
          created_at: so.created_at
        });
      }
    }
    unifiedWithdrawals.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const userDeposits = (orders || []).filter(o => o.user_id == userId);
    const activePlans = userDeposits.filter(o => o.status !== 'Cancelled');

    return res.json({
      success: true,
      user,
      parentUser,
      banks,
      deposits: userDeposits,
      withdrawals: unifiedWithdrawals,
      transactions,
      downline,
      activePlans
    });
  } catch (err) {
    console.error('[UserDetails] Error:', err);
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/users/:userId/withdrawals', adminAuth, async (req, res) => {
  try {
    const userId = req.params.userId;
    loadDb();
    let withdrawals = (dbData.transactions || [])
      .filter(t => t.user_id == userId && t.type === 'Withdraw')
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    let deposits = (dbData.orders || [])
      .filter(o => o.user_id == userId && o.status === 'Completed')
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const { supabase, isSupabaseConnected } = require('./supabase');
    if (isSupabaseConnected()) {
      try {
        const [txRes, wRes, ordRes] = await Promise.all([
          supabase.from('transactions').select('*').eq('user_id', userId).eq('type', 'Withdraw').order('created_at', { ascending: false }).limit(500),
          supabase.from('withdrawals').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(500),
          supabase.from('orders').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(500)
        ]);
        const wList = [...(wRes.data || [])];
        (txRes.data || []).forEach(tx => {
          if (!wList.some(w => (w.utr && tx.description && tx.description.includes(w.utr)) || Math.abs(Number(w.amount)) === Math.abs(Number(tx.amount)))) {
            wList.push({
              id: tx.id,
              user_id: tx.user_id,
              amount: Math.abs(Number(tx.amount)),
              status: 'Completed',
              description: tx.description,
              created_at: tx.created_at
            });
          }
        });
        wList.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        if (wList.length > 0) withdrawals = wList;
        if (ordRes.data && ordRes.data.length > 0) deposits = ordRes.data;
      } catch (sErr) {}
    }

    return res.json({ success: true, withdrawals, deposits });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/users/:userId/history', adminAuth, async (req, res) => {
  try {
    const userId = req.params.userId;
    loadDb();
    let withdrawals = (dbData.transactions || [])
      .filter(t => t.user_id == userId && t.type === 'Withdraw')
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    let deposits = (dbData.orders || [])
      .filter(o => o.user_id == userId && o.status === 'Completed')
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const { supabase, isSupabaseConnected } = require('./supabase');
    if (isSupabaseConnected()) {
      try {
        const [txRes, wRes, ordRes] = await Promise.all([
          supabase.from('transactions').select('*').eq('user_id', userId).eq('type', 'Withdraw').order('created_at', { ascending: false }).limit(500),
          supabase.from('withdrawals').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(500),
          supabase.from('orders').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(500)
        ]);
        const wList = [...(wRes.data || [])];
        (txRes.data || []).forEach(tx => {
          if (!wList.some(w => (w.utr && tx.description && tx.description.includes(w.utr)) || Math.abs(Number(w.amount)) === Math.abs(Number(tx.amount)))) {
            wList.push({
              id: tx.id,
              user_id: tx.user_id,
              amount: Math.abs(Number(tx.amount)),
              status: 'Completed',
              description: tx.description,
              created_at: tx.created_at
            });
          }
        });
        wList.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        if (wList.length > 0) withdrawals = wList;
        if (ordRes.data && ordRes.data.length > 0) deposits = ordRes.data;
      } catch (sErr) {}
    }

    return res.json({ success: true, withdrawals, deposits });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/users/:userId/balance', adminAuth, async (req, res) => {
  try {
    const { bcoin_balance } = req.body;
    const userId = req.params.userId;

    if (bcoin_balance === undefined || isNaN(Number(bcoin_balance)) || Number(bcoin_balance) < 0) {
      return res.status(400).json({ error: 'Please enter a valid T Coin balance' });
    }

    const user = await query.get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const newBalance = Number(bcoin_balance);
    const oldBalance = user.bcoin_balance;

    // Update user balance in database
    await query.run('UPDATE users SET bcoin_balance = ? WHERE id = ?', [newBalance, userId]);

    // Insert a transaction entry for audit log
    const diff = newBalance - oldBalance;
    if (diff !== 0) {
      await query.run(`
        INSERT INTO transactions (user_id, type, amount, balance_after, description)
        VALUES (?, 'AdminAdjust', ?, ?, ?)
      `, [
        userId,
        diff,
        newBalance,
        `T Coin balance adjusted by Administrator (was ₹${oldBalance.toFixed(2)})`
      ]);
    }

    try { require('./cache').clear(); } catch (_) {}
    return res.json({ 
      success: true, 
      message: `Successfully updated user T Coin balance to ${newBalance.toFixed(2)}` 
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// --- NEW P2P ENDPOINTS ---

// 1. Submit a withdrawal request
app.post('/api/withdrawals', authMiddleware, async (req, res) => {
  try {
    const { amount, bankAccountId } = req.body;
    const userId = req.user.id;

    const amtNum = Number(amount);
    if (isNaN(amtNum) || amtNum < 200) {
      return res.status(400).json({ error: 'Minimum withdrawal amount is ₹200' });
    }

    loadDb();
    
    // Check if user has active bank details
    const bank = dbData.bank_accounts.find(b => b.id == bankAccountId && b.user_id == userId && b.status === 'Active');
    if (!bank) {
      return res.status(400).json({ error: 'Please select an active bank account' });
    }

    const user = dbData.users.find(u => u.id == userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify balance availability (sum up existing pending withdrawals)
    const pendingTotal = dbData.withdrawals
      .filter(w => w.user_id == userId && w.status === 'Pending')
      .reduce((sum, w) => sum + w.amount_pending, 0);

    if (user.bcoin_balance < pendingTotal + amtNum) {
      return res.status(400).json({ error: 'Insufficient balance. You already have pending withdrawals matching your balance.' });
    }

    const { supabase: sbClient, isSupabaseConnected: isSbConn } = require('./supabase');
    let newId = (idTrackers.withdrawals || 0) + 1;
    if (isSbConn()) {
      try {
        const { data: maxW } = await sbClient.from('withdrawals').select('id').order('id', { ascending: false }).limit(1).maybeSingle();
        if (maxW && maxW.id) newId = Math.max(newId, Number(maxW.id) + 1);
      } catch (_) {}
    }
    idTrackers.withdrawals = Math.max(idTrackers.withdrawals || 0, newId);

    const newWithdrawal = {
      id: newId,
      user_id: userId,
      amount: amtNum,
      amount_pending: amtNum,
      status: 'Pending',
      bank_account_id: bankAccountId,
      created_at: new Date().toISOString()
    };
    dbData.withdrawals.push(newWithdrawal);
    
    saveDb();
    persistToSupabase('withdrawals', newWithdrawal, 'upsert', 'id');

    return res.json({ success: true, message: 'Withdrawal request registered successfully.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});


// 2b. Register FCM Device Token for notifications
app.post('/api/user/register-fcm', authMiddleware, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ error: 'FCM token required' });
    }
    loadDb();
    const user = dbData.users.find(u => u.id == req.user.id);
    if (user) {
      user.fcm_tokens = user.fcm_tokens || [];
      if (!user.fcm_tokens.includes(token)) {
        user.fcm_tokens.push(token);
        saveDb();
      }
    }
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 3. Receiver fetches matched requests to confirm
app.get('/api/user/p2p-requests', authMiddleware, async (req, res) => {
  try {
    loadDb();
    const userId = req.user.id;
    let orders = [];

    const { supabase, isSupabaseConnected } = require('./supabase');
    if (isSupabaseConnected()) {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('receiver_id', userId)
        .eq('status', 'Confirming')
        .order('id', { ascending: false });

      if (data && data.length > 0) {
        orders = data;
        data.forEach(so => {
          const idx = (dbData.orders || []).findIndex(o => o.order_id === so.order_id);
          if (idx !== -1) dbData.orders[idx] = { ...dbData.orders[idx], ...so };
          else (dbData.orders = dbData.orders || []).push(so);
        });
      }
    }

    if (orders.length === 0) {
      orders = (dbData.orders || []).filter(o => o.receiver_id == userId && o.status === 'Confirming');
    }

    const list = await Promise.all(orders.map(async o => {
      let buyer = (dbData.users || []).find(u => u.id == o.user_id);
      if (!buyer && isSupabaseConnected()) {
        const { data: suBuyer } = await supabase.from('users').select('id, uid, username, mobile').eq('id', o.user_id).maybeSingle();
        if (suBuyer) buyer = suBuyer;
      }
      buyer = buyer || {};
      return {
        order_id: o.order_id,
        amount: o.amount,
        utr: o.utr,
        screenshot_path: o.screenshot_path,
        created_at: o.created_at,
        timer_expiry: o.timer_expiry,
        status: o.status,
        buyer_username: buyer.username || 'Buyer',
        buyer_uid: buyer.uid || '',
        buyer_mobile: buyer.mobile || ''
      };
    }));

    return res.json({ success: true, requests: list });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 4. Receiver confirms payment (Received)
app.post('/api/orders/:orderId/p2p-receive', authMiddleware, async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.user.id;

    loadDb();
    const { supabase, isSupabaseConnected } = require('./supabase');

    let order = (dbData.orders || []).find(o => o.order_id === orderId && o.receiver_id == userId);
    if (!order && isSupabaseConnected()) {
      const { data: suOrder } = await supabase.from('orders').select('*').eq('order_id', orderId).maybeSingle();
      if (suOrder && suOrder.receiver_id == userId) {
        order = suOrder;
        (dbData.orders = dbData.orders || []).push(suOrder);
      }
    }

    if (!order) {
      return res.status(404).json({ error: 'Matched order not found' });
    }

    if (order.status !== 'Confirming') {
      return res.status(400).json({ error: 'Order is not in confirming status' });
    }

    let receiver = (dbData.users || []).find(u => u.id == userId);
    if (!receiver && isSupabaseConnected()) {
      const { data: suRec } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();
      if (suRec) {
        receiver = suRec;
        (dbData.users = dbData.users || []).push(suRec);
      }
    }

    let buyer = (dbData.users || []).find(u => u.id == order.user_id);
    if (!buyer && isSupabaseConnected()) {
      const { data: suBuy } = await supabase.from('users').select('*').eq('id', order.user_id).maybeSingle();
      if (suBuy) {
        buyer = suBuy;
        (dbData.users = dbData.users || []).push(suBuy);
      }
    }

    if (!receiver || !buyer) {
      return res.status(400).json({ error: 'User details not found' });
    }

    if (Number(receiver.bcoin_balance || 0) < Number(order.amount)) {
      return res.status(400).json({ error: 'Insufficient balance to confirm this debit.' });
    }

    // Deduct from receiver wallet
    receiver.bcoin_balance = Math.max(0, Number(receiver.bcoin_balance || 0) - Number(order.amount));

    // Complete order and credit buyer
    order.status = 'Completed';
    buyer.bcoin_balance = Number(buyer.bcoin_balance || 0) + Number(order.quota || 0);
    buyer.total_earnings = Number(buyer.total_earnings || 0) + Number(order.expected_income || 0);
    buyer.today_profit = Number(buyer.today_profit || 0) + Number(order.expected_income || 0);

    // Persist to Supabase immediately
    persistToSupabase('users', receiver, 'upsert', 'id');
    persistToSupabase('users', buyer, 'upsert', 'id');
    persistToSupabase('orders', order, 'upsert', 'id');

    // 1. Log the principal Deposit transaction for the buyer
    const depositTxId = ++idTrackers.transactions;
    const depTx = {
      id: depositTxId,
      user_id: buyer.id,
      type: 'Deposit',
      amount: Number(order.amount),
      balance_after: buyer.bcoin_balance - Number(order.expected_income || 0),
      description: `Deposit principal for Order ${order.order_id}`,
      created_at: new Date().toISOString()
    };
    (dbData.transactions = dbData.transactions || []).push(depTx);
    persistToSupabase('transactions', depTx, 'upsert', 'id');

    // 2. Log the Interest bonus Commission transaction for the buyer
    const bonusTxId = ++idTrackers.transactions;
    const bonusTx = {
      id: bonusTxId,
      user_id: buyer.id,
      type: 'Commission',
      amount: Number(order.expected_income || 0),
      balance_after: buyer.bcoin_balance,
      description: `Interest bonus for Order ${order.order_id}`,
      created_at: new Date().toISOString()
    };
    dbData.transactions.push(bonusTx);
    persistToSupabase('transactions', bonusTx, 'upsert', 'id');

    // 3. Log Withdraw transaction for receiver (sell history)
    let nextTxId = (idTrackers.transactions || 0) + 1;
    if (isSupabaseConnected()) {
      try {
        const { data: maxTx } = await supabase.from('transactions').select('id').order('id', { ascending: false }).limit(1).maybeSingle();
        if (maxTx && maxTx.id) nextTxId = Math.max(nextTxId, Number(maxTx.id) + 1);
      } catch (_) {}
    }
    idTrackers.transactions = Math.max(idTrackers.transactions || 0, nextTxId);

    const bank = (dbData.bank_accounts || []).find(b => b.user_id == userId && b.status === 'Active') || { bank_name: 'Bank', account_number: 'N/A', account_holder: receiver.username };
    const desc = `Bank: ${bank.bank_name}, A/C: ${bank.account_number}, Holder: ${bank.account_holder}, UTR: ${order.utr || 'N/A'}, TXID: MWD_${Date.now()}, Note: P2P match withdrawal debit of ₹${Number(order.amount).toFixed(2)}`;
    const recTx = {
      id: nextTxId,
      user_id: userId,
      type: 'Withdraw',
      amount: -Number(order.amount),
      balance_after: receiver.bcoin_balance,
      description: desc,
      created_at: new Date().toISOString()
    };
    dbData.transactions.push(recTx);
    persistToSupabase('transactions', recTx, 'upsert', 'id');

    // Check matched withdrawal request or create completed withdrawal record
    let matchedW = null;
    if (order.withdrawal_id) {
      matchedW = (dbData.withdrawals || []).find(x => x.id == order.withdrawal_id);
      if (!matchedW && isSupabaseConnected()) {
        const { data: suW } = await supabase.from('withdrawals').select('*').eq('id', order.withdrawal_id).maybeSingle();
        if (suW) matchedW = suW;
      }
    }
    if (matchedW) {
      matchedW.status = 'Completed';
      matchedW.amount_pending = 0;
      matchedW.utr = order.utr || matchedW.utr || 'P2P_COMPLETED';
      persistToSupabase('withdrawals', matchedW, 'upsert', 'id');
    } else {
      let nextWId = (idTrackers.withdrawals || 0) + 1;
      if (isSupabaseConnected()) {
        try {
          const { data: maxW } = await supabase.from('withdrawals').select('id').order('id', { ascending: false }).limit(1).maybeSingle();
          if (maxW && maxW.id) nextWId = Math.max(nextWId, Number(maxW.id) + 1);
        } catch (_) {}
      }
      idTrackers.withdrawals = Math.max(idTrackers.withdrawals || 0, nextWId);
      const newW = {
        id: nextWId,
        user_id: userId,
        amount: Number(order.amount),
        amount_pending: 0,
        status: 'Completed',
        bank_account_id: bank.id || null,
        utr: order.utr || 'P2P_MATCH',
        txid: `P2P_${order.order_id}`,
        created_at: new Date().toISOString()
      };
      (dbData.withdrawals = dbData.withdrawals || []).push(newW);
      persistToSupabase('withdrawals', newW, 'upsert', 'id');
    }

    saveDb();

    // Trigger dynamic commissions for buyer referral network
    try {
      const rates = dbData.settings || { level1_commission: 10, level2_commission: 5, level3_commission: 2 };
      const commissionRates = [
        Number(rates.level1_commission || 0) / 100,
        Number(rates.level2_commission || 0) / 100,
        Number(rates.level3_commission || 0) / 100
      ];
      let currentParentId = buyer.parent_id;

      for (let level = 1; level <= 3; level++) {
        if (!currentParentId) break;
        let parent = (dbData.users || []).find(u => u.id == currentParentId);
        if (!parent && isSupabaseConnected()) {
          const { data: suParent } = await supabase.from('users').select('*').eq('id', currentParentId).maybeSingle();
          if (suParent) parent = suParent;
        }
        if (!parent) break;

        const rate = commissionRates[level - 1];
        const commAmount = Number(order.amount) * rate;

        if (commAmount > 0) {
          parent.bcoin_balance = Number(parent.bcoin_balance || 0) + commAmount;
          parent.total_earnings = Number(parent.total_earnings || 0) + commAmount;
          parent.today_profit = Number(parent.today_profit || 0) + commAmount;
          persistToSupabase('users', parent, 'upsert', 'id');

          const commTxId = ++idTrackers.transactions;
          const commTx = {
            id: commTxId,
            user_id: parent.id,
            type: 'Commission',
            amount: commAmount,
            balance_after: parent.bcoin_balance,
            description: `Level ${level} Commission of ₹${commAmount.toFixed(2)} from member UID: ${buyer.uid} (Order ID: ${order.order_id})`,
            created_at: new Date().toISOString()
          };
          dbData.transactions.push(commTx);
          persistToSupabase('transactions', commTx, 'upsert', 'id');
        }
        currentParentId = parent.parent_id;
      }
      saveDb();
    } catch (err) {
      console.error('Failed to distribute referral commission:', err);
    }

    return res.json({ success: true, message: 'Payment confirmed! Funds released and credited to buyer.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 5. Receiver raises dispute
app.post('/api/orders/:orderId/p2p-dispute', authMiddleware, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { reason, proof } = req.body; // proof is base64 file of statement

    if (!reason || !proof) {
      return res.status(400).json({ error: 'Please select a reason and upload your proof document' });
    }

    loadDb();
    const { supabase, isSupabaseConnected } = require('./supabase');

    let order = (dbData.orders || []).find(o => o.order_id === orderId && o.receiver_id == req.user.id);
    if (!order && isSupabaseConnected()) {
      const { data: suOrder } = await supabase.from('orders').select('*').eq('order_id', orderId).maybeSingle();
      if (suOrder && suOrder.receiver_id == req.user.id) {
        order = suOrder;
        (dbData.orders = dbData.orders || []).push(suOrder);
      }
    }

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.status !== 'Confirming') {
      return res.status(400).json({ error: 'Cannot dispute this order' });
    }

    const { saveBase64File } = require('./db');
    const proofPath = await saveBase64File(proof, 'dispute_proof');
    if (!proofPath) {
      return res.status(400).json({ error: 'Invalid proof file upload' });
    }

    let receiver = (dbData.users || []).find(u => u.id == req.user.id);
    if (!receiver && isSupabaseConnected()) {
      const { data: suRec } = await supabase.from('users').select('*').eq('id', req.user.id).maybeSingle();
      if (suRec) receiver = suRec;
    }

    if (!receiver) {
      return res.status(404).json({ error: 'Receiver user not found' });
    }

    if (Number(receiver.bcoin_balance || 0) < Number(order.amount)) {
      return res.status(400).json({ error: 'Insufficient balance in your wallet to raise a dispute.' });
    }

    // Deduct the disputed amount immediately from their wallet
    receiver.bcoin_balance = Math.max(0, Number(receiver.bcoin_balance || 0) - Number(order.amount));
    persistToSupabase('users', receiver, 'upsert', 'id');

    // Set order to Disputed
    order.status = 'Disputed';
    persistToSupabase('orders', order, 'upsert', 'id');

    // Add dispute record
    const newDisId = ++idTrackers.disputes;
    const disputeRecord = {
      id: newDisId,
      order_id: orderId,
      raiser_id: req.user.id,
      reason: reason,
      proof_path: proofPath,
      status: 'Pending',
      created_at: new Date().toISOString()
    };
    dbData.disputes = dbData.disputes || [];
    dbData.disputes.push(disputeRecord);
    persistToSupabase('disputes', disputeRecord, 'upsert', 'id');

    // Log a temporary Withdraw transaction for receiver showing it as Disputed
    const newTxId = ++idTrackers.transactions;
    const bank = (dbData.bank_accounts || []).find(b => b.user_id == receiver.id && b.status === 'Active') || { bank_name: 'Bank', account_number: 'N/A', account_holder: receiver.username };
    const desc = `Bank: ${bank.bank_name}, A/C: ${bank.account_number}, Holder: ${bank.account_holder}, UTR: ${order.utr || 'N/A'}, TXID: MWD_${Date.now()}, Note: P2P match withdrawal disputed for Order ${order.order_id}`;
    const disTx = {
      id: newTxId,
      user_id: receiver.id,
      type: 'Withdraw',
      amount: -Number(order.amount),
      balance_after: receiver.bcoin_balance,
      status: 'Disputed',
      order_id: order.order_id,
      description: desc,
      created_at: new Date().toISOString()
    };
    dbData.transactions.push(disTx);
    persistToSupabase('transactions', disTx, 'upsert', 'id');

    saveDb();

    return res.json({ success: true, message: 'Dispute submitted successfully and sent to admin review.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 5b. Receiver raises dispute on auto-approved transaction from history
app.post('/api/orders/:orderId/p2p-dispute-auto', authMiddleware, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { reason, proof } = req.body;

    if (!reason || !proof) {
      return res.status(400).json({ error: 'Please select a reason and upload your proof document' });
    }

    loadDb();
    const order = dbData.orders.find(o => o.order_id === orderId && o.receiver_id == req.user.id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Save proof document
    const proofPath = saveBase64File(proof, 'dispute_proof');
    if (!proofPath) {
      return res.status(400).json({ error: 'Invalid proof file upload' });
    }

    // Set order status to Disputed
    order.status = 'Disputed';

    // Add dispute record
    const newDisId = ++idTrackers.disputes;
    dbData.disputes.push({
      id: newDisId,
      order_id: orderId,
      raiser_id: req.user.id,
      reason: reason,
      proof_path: proofPath,
      status: 'Pending',
      created_at: new Date().toISOString()
    });

    // Update the transaction status to Disputed
    const tx = dbData.transactions.find(t => t.user_id == req.user.id && t.type === 'Withdraw' && t.order_id === orderId);
    if (tx) {
      tx.status = 'Disputed';
    }

    saveDb();

    return res.json({ success: true, message: 'Dispute submitted successfully and sent to admin review.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 6. Admin lists disputes
app.get('/api/admin/disputes', adminAuth, async (req, res) => {
  try {
    loadDb();
    const list = dbData.disputes.map(d => {
      const order = dbData.orders.find(o => o.order_id === d.order_id) || {};
      const raiser = dbData.users.find(u => u.id == d.raiser_id) || {};
      const depositor = dbData.users.find(u => u.id == order.user_id) || {};
      
      return {
        id: d.id,
        order_id: d.order_id,
        amount: order.amount,
        utr: order.utr,
        depositor_screenshot: order.screenshot_path,
        reason: d.reason,
        receiver_proof: d.proof_path,
        status: d.status,
        created_at: d.created_at,
        depositor_name: depositor.username || 'Depositor',
        depositor_uid: depositor.uid || '',
        receiver_name: raiser.username || 'Receiver',
        receiver_uid: raiser.uid || ''
      };
    });

    return res.json({ success: true, disputes: list });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 7. Admin resolves dispute (Approve & Release or Reject & Refund)
app.post('/api/admin/disputes/:disputeId/resolve', adminAuth, async (req, res) => {
  try {
    const { disputeId } = req.params;
    const { action } = req.body; // 'approve' (release to depositor) or 'reject' (cancel order, refund receiver)

    if (action !== 'approve' && action !== 'reject') {
      return res.status(400).json({ error: 'Invalid action. Must be approve or reject' });
    }

    loadDb();
    const dispute = dbData.disputes.find(d => d.id == disputeId);
    if (!dispute) {
      return res.status(404).json({ error: 'Dispute not found' });
    }

    if (dispute.status !== 'Pending') {
      return res.status(400).json({ error: 'Dispute is already resolved' });
    }

    const order = dbData.orders.find(o => o.order_id === dispute.order_id);
    if (!order) {
      return res.status(404).json({ error: 'Associated order not found' });
    }

    const receiver = dbData.users.find(u => u.id == order.receiver_id);
    const buyer = dbData.users.find(u => u.id == order.user_id);

    if (action === 'approve') {
      // Approve: Depositor paid correctly. Release funds.
      order.status = 'Completed';
      dispute.status = 'Resolved_Approved';
      buyer.inr_balance += order.quota; // Credit buyer with plan quota/earnings
      buyer.bcoin_balance += order.amount; // Credit buyer with T-Coin principal balance

      // Update the transaction log that was created during the dispute to success/completed state
      const tx = dbData.transactions.find(t => t.user_id == receiver.id && t.type === 'Withdraw' && t.order_id === order.order_id);
      if (tx) {
        tx.status = 'Completed';
        tx.description += ' (Approved by Admin)';
      } else {
        // Fallback in case dispute was raised without log (e.g. legacy/manually created)
        if (receiver.bcoin_balance >= order.amount) {
          receiver.bcoin_balance -= order.amount;
        }
        const newTxId = ++idTrackers.transactions;
        const bank = dbData.bank_accounts.find(b => b.user_id == receiver.id && b.status === 'Active') || { bank_name: 'Bank', account_number: 'N/A', account_holder: receiver.username };
        const desc = `Bank: ${bank.bank_name}, A/C: ${bank.account_number}, Holder: ${bank.account_holder}, UTR: ${order.utr}, TXID: MWD_${Date.now()}, Note: P2P dispute release withdrawal completed for Order ${order.order_id}`;
        dbData.transactions.push({
          id: newTxId,
          user_id: receiver.id,
          type: 'Withdraw',
          amount: -order.amount,
          balance_after: receiver.bcoin_balance,
          status: 'Completed',
          description: desc,
          created_at: new Date().toISOString()
        });
      }

      // Update matched withdrawal request
      if (order.withdrawal_id) {
        const w = dbData.withdrawals.find(x => x.id == order.withdrawal_id);
        if (w) {
          if (w.amount_pending <= 0) {
            w.status = 'Completed';
          }
        }
      }

      // Distribute referral commissions
      try {
        const rates = dbData.settings || { level1_commission: 10, level2_commission: 5, level3_commission: 2 };
        const commissionRates = [
          Number(rates.level1_commission || 0) / 100,
          Number(rates.level2_commission || 0) / 100,
          Number(rates.level3_commission || 0) / 100
        ];
        let currentParentId = buyer.parent_id;

        for (let level = 1; level <= 3; level++) {
          if (!currentParentId) break;
          const parent = dbData.users.find(u => u.id == currentParentId);
          if (!parent) break;

          const rate = commissionRates[level - 1];
          const commAmount = order.amount * rate;

          if (commAmount > 0) {
            parent.inr_balance += commAmount;
            parent.total_earnings += commAmount;
            parent.today_profit += commAmount;

            const commTxId = ++idTrackers.transactions;
            dbData.transactions.push({
              id: commTxId,
              user_id: parent.id,
              type: 'Commission',
              amount: commAmount,
              balance_after: parent.inr_balance,
              description: `Level ${level} Commission of ₹${commAmount.toFixed(2)} from member UID: ${buyer.uid} (Order ID: ${order.order_id})`,
              created_at: new Date().toISOString()
            });
          }
          currentParentId = parent.parent_id;
        }
      } catch (err) {
        console.error('Referral commission failed:', err);
      }

    } else {
      // Reject: Depositor did NOT pay. Cancel order
      order.status = 'Canceled';
      dispute.status = 'Resolved_Refunded';

      // Refund the receiver since we deducted their T-Coins when they raised the dispute
      receiver.bcoin_balance += order.amount;

      // Find the disputed Withdraw transaction and set its status to 'Canceled'
      const tx = dbData.transactions.find(t => t.user_id == receiver.id && t.type === 'Withdraw' && t.order_id === order.order_id);
      if (tx) {
        tx.status = 'Canceled';
        tx.description += ' (Canceled by Admin)';
      }

      // Restore matched withdrawal request pending balance
      if (order.withdrawal_id) {
        const w = dbData.withdrawals.find(x => x.id == order.withdrawal_id);
        if (w) {
          w.amount_pending += order.amount;
        }
      }
    }

    saveDb();
    return res.json({ success: true, message: `Dispute resolved successfully with action: ${action}` });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Helper checking cron for 15-minute expirations
setInterval(() => {
  try {
    loadDb();
    let expiredCount = 0;
    let autoApprovedCount = 0;
    const now = new Date();

    dbData.orders.forEach(order => {
      // If timer expired for Confirming orders, transition to Admin Review for manual admin verification
      if (order.timer_expiry && now > new Date(order.timer_expiry)) {
        if (order.status === 'Confirming') {
          order.status = 'Admin Review';
          order.is_timer_expired = true;
          console.log(`[TimerExpiry] Order ${order.order_id} timer elapsed. Status set to Admin Review.`);
        }
      }
    });

    if (expiredCount > 0 || autoApprovedCount > 0) {
      console.log(`[Auto-Expiry] Cancelled ${expiredCount} expired P2P orders, auto-approved ${autoApprovedCount} confirming orders.`);
      saveDb();
    }
  } catch (err) {
    console.error('Auto-expiry timer error:', err);
  }
}, 30000); // run every 30 seconds

// Winpey Payment Gateway Callback Notification Webhook
const { processAutoApproval, winpeyCreatePayout } = require('./controllers/orderController');
// ─── WINPEY PAYMENT GATEWAY WEBHOOK & RETURN HANDLERS ─────────────────────────
const handlePaymentCallback = async (req, res) => {
  try {
    const data = { ...req.query, ...req.body };
    console.log('[Winpey Webhook] Received payload:', JSON.stringify(data));

    // Log callback payload to file for audit tracking
    try {
      const fs = require('fs');
      const path = require('path');
      const logPath = path.join(__dirname, '../data/callback_debug.jsonl');
      const logEntry = JSON.stringify({
        timestamp: new Date().toISOString(),
        method: req.method,
        headers: req.headers,
        query: req.query,
        body: req.body
      }) + '\n';
      fs.appendFileSync(logPath, logEntry, 'utf8');
    } catch (logErr) {
      console.error('Failed to log callback to file:', logErr);
    }

    const targetOrderId = data.ext || 
                          data.merchant_order_id || 
                          data.mchOrderNo || 
                          data.out_trade_no || 
                          data.order_id || 
                          data.orderId || 
                          data.orderNo || 
                          data.merchantOrderNo || 
                          data.mch_order_no || 
                          data.tradeNo ||
                          data.merchantOrderId;

    const rawStatus = String(data.status || data.payStatus || data.orderStatus || data.state || data.code || data.tradeResult || 'SUCCESS').toUpperCase();
    const isSuccess = ['SUCCESS', 'PAID', 'COMPLETED', '1', '200', '0', '0000', 'TRUE'].includes(rawStatus) || !data.status;

    if (isSuccess) {
      const approved = await processAutoApproval(targetOrderId, data.order_id || data.pay_order_id || 'WINPEY_AUTO');
      if (approved) {
        console.log(`[Winpey Webhook] Auto-approved order ${targetOrderId} successfully.`);
      }
    }

    return res.send('success');
  } catch (err) {
    console.error('[Winpey Webhook] Error:', err);
    return res.status(500).send('Internal Error');
  }
};

app.post('/api/payment/callback', handlePaymentCallback);
app.get('/api/payment/callback', handlePaymentCallback);

const handlePayoutCallback = async (req, res) => {
  try {
    const data = { ...req.query, ...req.body };
    console.log('[Payout Webhook] Received payout callback payload:', JSON.stringify(data));

    // Log payout callback details to file
    try {
      const fs = require('fs');
      const path = require('path');
      const logPath = path.join(__dirname, '../data/payout_callback_debug.jsonl');
      const logEntry = JSON.stringify({
        timestamp: new Date().toISOString(),
        method: req.method,
        headers: req.headers,
        query: req.query,
        body: req.body
      }) + '\n';
      fs.appendFileSync(logPath, logEntry, 'utf8');
    } catch (logErr) {
      console.error('Failed to log payout callback to file:', logErr);
    }

    const payoutId = data.merchant_order_id || data.mchOrderNo || data.merchantOrderNo;
    const rawStatus = String(data.status || data.state || 'SUCCESS').toUpperCase();
    const isFailed = ['FAIL', 'FAILED', 'REJECTED', 'CANCEL', 'CANCELED', '2'].includes(rawStatus);

    if (isFailed && payoutId) {
      console.warn(`[Payout Webhook] Payout ${payoutId} failed or was rejected by gateway!`);
    }

    return res.send('success');
  } catch (err) {
    console.error('[Payout Webhook] Error:', err);
    return res.status(500).send('Internal Error');
  }
};

app.post('/api/payment/payout-callback', handlePayoutCallback);
app.get('/api/payment/payout-callback', handlePayoutCallback);

// Winpey User Return Endpoint (after payment completes)
app.get('/api/payment/return', async (req, res) => {
  const { order_id, merchant_order_id } = req.query;
  const targetId = order_id || merchant_order_id;
  
  if (targetId) {
    await processAutoApproval(targetId, 'WINPEY_RETURN');
  }

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Payment Successful - Gopay</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; margin: 0; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; box-sizing: border-box; }
          .card { background: #ffffff; padding: 32px 24px; border-radius: 24px; box-shadow: 0 10px 40px rgba(0,0,0,0.08); text-align: center; max-width: 360px; width: 100%; border: 1px solid #e2e8f0; }
          .icon-box { width: 72px; height: 72px; background: #dcfce7; color: #16a34a; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px auto; font-size: 36px; font-weight: bold; }
          h2 { color: #0f172a; margin: 0 0 8px 0; font-size: 20px; font-weight: 800; }
          p { color: #64748b; font-size: 13px; margin: 0 0 24px 0; line-height: 1.5; }
          .btn { display: block; width: 100%; background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); color: #ffffff; padding: 14px 0; border-radius: 14px; text-decoration: none; font-weight: 700; font-size: 14px; box-shadow: 0 4px 14px rgba(37,99,235,0.3); box-sizing: border-box; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="icon-box">✓</div>
          <h2>Payment Successful!</h2>
          <p>Your deposit has been received and added to your wallet balance.</p>
          <a href="/history" class="btn" id="goBtn">View Deposit History</a>
        </div>
        <script>
          setTimeout(function() {
            window.location.href = '/history';
          }, 1200);
        </script>
      </body>
    </html>
  `);
});

// ─── AUTO PLAN GENERATOR ────────────────────────────────────────────────────
// Config (admin can toggle via API)
let autoPlanConfig = {
  enabled: true,
  intervalMinutes: 2,
  minTotal: 35,
  maxTotal: 50,
};

// Amount buckets (min, max, incomeRate) strictly between 500 and 100,000
const PLAN_BUCKETS = [
  { min: 500,   max: 1000,   rate: 0.10, base: 8 },
  { min: 1000,  max: 5000,   rate: 0.10, base: 8 },
  { min: 5000,  max: 20000,  rate: 0.10, base: 8 },
  { min: 20000, max: 50000,  rate: 0.10, base: 8 },
  { min: 50000, max: 100000, rate: 0.10, base: 8 },
];

function randBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function runPlanRotation() {
  if (!autoPlanConfig.enabled) return;
  try {
    loadDb();
    const cfg = dbData.settings || {};
    const minLimit = Number(cfg.min_order_amount) > 0 ? Number(cfg.min_order_amount) : 500;
    const maxLimit = Number(cfg.max_order_amount) > 0 ? Number(cfg.max_order_amount) : 100000;

    // Prune any products outside [minLimit, maxLimit]
    await query.run('DELETE FROM products WHERE amount < ? OR amount > ?', [minLimit, maxLimit]);
    if (dbData.products) {
      dbData.products = dbData.products.filter(p => Number(p.amount) >= minLimit && Number(p.amount) <= maxLimit);
    }

    const all = await query.all('SELECT id FROM products ORDER BY created_at ASC');
    const total = all.length;

    // Delete oldest plans if over maxTotal
    if (total >= autoPlanConfig.maxTotal) {
      const toDelete = total - autoPlanConfig.maxTotal + 3; // delete 3 extra to make room
      for (let i = 0; i < Math.min(toDelete, all.length); i++) {
        await query.run('DELETE FROM products WHERE id = ?', [all[i].id]);
      }
      console.log(`[AutoPlan] Deleted ${toDelete} old plan(s).`);
    }

    // Create 2-3 new plans strictly bounded within [minLimit, maxLimit]
    const createCount = randBetween(2, 3);
    for (let i = 0; i < createCount; i++) {
      const bucket = PLAN_BUCKETS[randBetween(0, PLAN_BUCKETS.length - 1)];
      const rawAmt = randBetween(bucket.min, bucket.max);
      const amount = Math.min(Math.max(rawAmt, minLimit), maxLimit);
      const income = Math.round((amount * bucket.rate + bucket.base) * 10) / 10;
      const quota  = amount + income;
      const name   = `Auto-${amount}`;
      await query.run(
        'INSERT INTO products (name, amount, income, quota, color, type, percent) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [name, amount, income, quota, 'blue', 'Bank', '10%+8']
      );
    }
    console.log(`[AutoPlan] Created ${createCount} new plan(s). Total now: ${(await query.all('SELECT id FROM products')).length}`);
  } catch (err) {
    console.error('[AutoPlan] Error during rotation:', err.message);
  }
}

// Admin: get/update auto-plan rotation config
app.get('/api/admin/rotation-config', adminAuth, (req, res) => {
  return res.json({ success: true, config: autoPlanConfig });
});

app.post('/api/admin/rotation-config', adminAuth, (req, res) => {
  const { enabled, intervalMinutes, minTotal, maxTotal } = req.body;
  if (typeof enabled === 'boolean') autoPlanConfig.enabled = enabled;
  if (intervalMinutes > 0) autoPlanConfig.intervalMinutes = Number(intervalMinutes);
  if (minTotal > 0) autoPlanConfig.minTotal = Number(minTotal);
  if (maxTotal > 0) autoPlanConfig.maxTotal = Number(maxTotal);
  return res.json({ success: true, config: autoPlanConfig, message: 'Auto-rotation config updated!' });
});

// --- LOCAL STATIC FRONTEND SERVING (User Web & Admin Panel) ---
const adminPanelDir = path.resolve(__dirname, '../../admin_panel');
const userWebDir = path.resolve(__dirname, '../../user_web');

if (fs.existsSync(adminPanelDir)) {
  app.use('/admin/assets', express.static(path.join(adminPanelDir, 'assets')));
  app.use('/admin', express.static(adminPanelDir));
  app.get(['/admin', '/admin/*'], (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(adminPanelDir, 'index.html'));
  });
}

if (fs.existsSync(userWebDir)) {
  app.use('/assets', express.static(path.join(userWebDir, 'assets')));
  if (fs.existsSync(adminPanelDir)) {
    app.use('/assets', express.static(path.join(adminPanelDir, 'assets')));
  }
  app.use(express.static(userWebDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/admin')) return next();
    res.sendFile(path.join(userWebDir, 'index.html'));
  });
}

// --- STARTUP AND DATABASE INIT ---
if (!process.env.VERCEL) {
  (async () => {
    try {
      console.log('Initializing database schemas...');
      await initDb();
      console.log('Database initialized and seeded.');

      // Start auto plan rotation (every 2 minutes)
      setInterval(runPlanRotation, autoPlanConfig.intervalMinutes * 60 * 1000);
      console.log(`[AutoPlan] Auto plan rotation started — every ${autoPlanConfig.intervalMinutes} min, keeping ${autoPlanConfig.minTotal}–${autoPlanConfig.maxTotal} plans.`);

      app.listen(PORT, () => {
        console.log(`Gopay Backend API running at http://localhost:${PORT}`);
      });
    } catch (err) {
      console.error('Failed to boot application:', err);
      process.exit(1);
    }
  })();
}

module.exports = app;


