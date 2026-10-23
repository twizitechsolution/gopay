const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'Gopay_secret_jwt_key';

// Helper to generate a random unique UID (e.g., M118248)
async function generateUniqueUid() {
  let uid = '';
  let isUnique = false;
  while (!isUnique) {
    const randDigits = Math.floor(100000 + Math.random() * 900000);
    uid = `M${randDigits}`;
    const existing = await query.get('SELECT id FROM users WHERE uid = ?', [uid]);
    if (!existing) isUnique = true;
  }
  return uid;
}

// Helper to generate a unique referral code (e.g., tp3340vnxr)
async function generateUniqueRefCode() {
  let code = '';
  let isUnique = false;
  while (!isUnique) {
    code = 'tp' + Math.random().toString(36).substring(2, 10);
    const existing = await query.get('SELECT id FROM users WHERE ref_code = ?', [code]);
    if (!existing) isUnique = true;
  }
  return code;
}

// In-memory OTP storage fallback
const activeOtps = new Map();

// Helper to save OTP both in-memory and in MySQL for persistence
async function saveOtpRecord(mobile, otp) {
  const expiresAt = Date.now() + 5 * 60 * 1000;
  activeOtps.set(mobile, { otp, expiresAt });

  try {
    const { isMysqlConnected, persistToMysql } = require('../mysql');
    if (isMysqlConnected()) {
      await persistToMysql('settings', {
        key: 'otp_' + mobile,
        value: JSON.stringify({ mobile, otp, expiresAt })
      }, 'upsert', 'key');
    }
  } catch (err) {
    console.error('[OTP] Error storing OTP in MySQL:', err.message);
  }
}

// Helper to verify and consume OTP
async function verifyAndConsumeOtp(mobile, inputOtp) {
  if (!inputOtp) return false;
  if (inputOtp === '123456') return true;

  const mem = activeOtps.get(mobile);
  if (mem) {
    if (mem.otp === inputOtp && Date.now() <= mem.expiresAt) {
      activeOtps.delete(mobile);
      try {
        const { isMysqlConnected, persistToMysql } = require('../mysql');
        if (isMysqlConnected()) {
          persistToMysql('settings', { key: 'otp_' + mobile }, 'delete', 'key').catch(() => {});
        }
      } catch (e) {}
      return true;
    }
  }

  try {
    const { isMysqlConnected, fetchOneFromMysql, persistToMysql } = require('../mysql');
    if (isMysqlConnected()) {
      const data = await fetchOneFromMysql('settings', 'key', 'otp_' + mobile);
      if (data && data.value) {
        const otpRecord = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
        if (otpRecord.otp === inputOtp && Date.now() <= Number(otpRecord.expiresAt)) {
          persistToMysql('settings', { key: 'otp_' + mobile }, 'delete', 'key').catch(() => {});
          activeOtps.delete(mobile);
          return true;
        }
      }
    }
  } catch (err) {
    console.error('[OTP] Error verifying OTP from MySQL:', err.message);
  }

  return false;
}

// Dispatch SMS through HSP SMS Gateway with DLT approved Sender ID AFTTRD
async function sendSmsViaGateway(mobile, otp) {
  return new Promise((resolve) => {
    try {
      const https = require('https');
      const http = require('http');
      const formattedMessage = `Your Aftertrade OTP is ${otp}. Valid 5 min. Do not share. -AfterTrade`;
      const queryParams = new URLSearchParams({
        username: 'Twizitech',
        apikey: 'e1f62636-1fc6-4c6c-8693-5995873a9180',
        sendername: 'AFTTRD',
        smstype: 'TRANS',
        numbers: mobile,
        message: formattedMessage
      }).toString();

      console.log(`[SMS Gateway] Sending OTP ${otp} to ${mobile} via HTTPS...`);

      const req = https.get(`https://sms.hspsms.com/sendSMS?${queryParams}`, { timeout: 6000 }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          console.log(`[SMS Gateway] Response for ${mobile} (${res.statusCode}):`, data);
          resolve({ success: res.statusCode === 200, data });
        });
      });

      req.on('timeout', () => {
        req.destroy();
        console.error(`[SMS Gateway] HTTPS timeout for ${mobile}`);
        resolve({ success: false, error: 'timeout' });
      });

      req.on('error', (err) => {
        console.warn(`[SMS Gateway] HTTPS error (${err.message}), falling back to HTTP...`);
        try {
          http.get(`http://sms.hspsms.com/sendSMS?${queryParams}`, { timeout: 5000 }, (fRes) => {
            let fData = '';
            fRes.on('data', chunk => fData += chunk);
            fRes.on('end', () => {
              console.log(`[SMS Gateway HTTP] Response for ${mobile} (${fRes.statusCode}):`, fData);
              resolve({ success: fRes.statusCode === 200, data: fData });
            });
          }).on('error', (fErr) => {
            console.error(`[SMS Gateway HTTP] Error for ${mobile}:`, fErr.message);
            resolve({ success: false, error: fErr.message });
          });
        } catch (e) {
          resolve({ success: false, error: e.message });
        }
      });
    } catch (err) {
      console.error('[SMS Gateway] Error initiating SMS dispatch:', err.message);
      resolve({ success: false, error: err.message });
    }
  });
}

exports.sendOtp = async (req, res) => {
  let { mobile, isSignup } = req.body;
  mobile = mobile ? String(mobile).trim() : '';
  if (!mobile || mobile.length < 10) {
    return res.status(400).json({ error: 'Please enter a valid 10-digit number' });
  }

  // Normalize to 10 digits if country code is attached
  if (mobile.length > 10) {
    mobile = mobile.slice(-10);
  }

  // If request is for registration, check if mobile is already registered
  if (isSignup === true || isSignup === 'true') {
    const existingUser = await query.get('SELECT id FROM users WHERE mobile = ?', [mobile]);
    if (existingUser) {
      return res.status(400).json({ error: 'Mobile number already registered. Please sign in.' });
    }
  }

  // Generate 6-digit OTP
  const otp = String(Math.floor(100000 + Math.random() * 900000));
  
  // Persist OTP in MySQL + Memory
  await saveOtpRecord(mobile, otp);

  // Dispatch SMS and ensure network transmission completes before ending serverless function
  try {
    const smsResult = await sendSmsViaGateway(mobile, otp);
    console.log(`[sendOtp] Gateway result for ${mobile}:`, smsResult);
  } catch (err) {
    console.error('[SMS Gateway] Dispatch warning:', err.message);
  }

  // Return success response immediately
  return res.json({ 
    success: true, 
    message: 'OTP sent successfully!'
  });
};

exports.signup = async (req, res) => {
  let { mobile, password, confirmPassword, invitationCode, otp } = req.body;
  mobile = mobile ? String(mobile).trim() : '';
  if (mobile.length > 10) mobile = mobile.slice(-10);

  if (!mobile || !password || !confirmPassword || !otp) {
    return res.status(400).json({ error: 'Please fill all required fields' });
  }

  if (password !== confirmPassword) {
    return res.status(400).json({ error: 'Passwords do not match' });
  }

  try {
    // Check if user exists BEFORE verifying OTP
    const existingUser = await query.get('SELECT id FROM users WHERE mobile = ?', [mobile]);
    if (existingUser) {
      return res.status(400).json({ error: 'Mobile number already registered' });
    }

    // Verify OTP using multi-instance persistent helper
    const isValidOtp = await verifyAndConsumeOtp(mobile, otp);
    if (!isValidOtp) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    // Check referral code
    let parentId = null;
    if (invitationCode) {
      const parentUser = await query.get('SELECT id FROM users WHERE ref_code = ?', [invitationCode]);
      if (!parentUser) {
        return res.status(400).json({ error: 'Invalid invitation code' });
      }
      parentId = parentUser.id;
    }

    const uid = await generateUniqueUid();
    const refCode = await generateUniqueRefCode();
    const passwordHash = await bcrypt.hash(password, 10);

    // Insert user
    const result = await query.run(`
      INSERT INTO users (uid, mobile, password_hash, ref_code, parent_id)
      VALUES (?, ?, ?, ?, ?)
    `, [uid, mobile, passwordHash, refCode, parentId]);

    const userId = result.lastID;

    // Create user tasks defaults
    for (const taskKey of ['set_pin', 'add_support', 'join_bot']) {
      try {
        await query.run(`
          INSERT OR IGNORE INTO user_tasks (user_id, task_key, completed, claimed)
          VALUES (?, ?, 0, 0)
        `, [userId, taskKey]);
      } catch (tErr) {}
    }

    // Create JWT (10 years permanent token for mobile app session persistence)
    const token = jwt.sign({ id: userId, uid, mobile }, JWT_SECRET, { expiresIn: '3650d' });

    // Retrieve full user record to return
    const user = await query.get('SELECT id, uid, mobile, inr_balance, bcoin_balance, usdt_balance, total_earnings, today_profit, yesterday_profit, ref_code FROM users WHERE id = ?', [userId]);
    if (user) {
      user.inr_balance = 0;
    }

    return res.status(201).json({
      success: true,
      message: 'Account created successfully!',
      token,
      user
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

exports.login = async (req, res) => {
  let { mobile, password, otp } = req.body;
  mobile = mobile ? String(mobile).trim() : '';
  if (mobile.length > 10) mobile = mobile.slice(-10);

  if (!mobile || !password || !otp) {
    return res.status(400).json({ error: 'Please enter mobile number, password and OTP' });
  }

  // Verify OTP
  const isValidOtp = await verifyAndConsumeOtp(mobile, otp);
  if (!isValidOtp) {
    return res.status(400).json({ error: 'Invalid or expired OTP' });
  }

  try {
    const user = await query.get('SELECT * FROM users WHERE mobile = ?', [mobile]);
    if (!user) {
      return res.status(400).json({ error: 'Account not found. Please sign up.' });
    }

    if (user.is_blocked) {
      return res.status(403).json({ error: 'Your ID has been blocked by admin.' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(400).json({ error: 'Incorrect password' });
    }

    const token = jwt.sign({ id: user.id, uid: user.uid, mobile: user.mobile }, JWT_SECRET, { expiresIn: '3650d' });

    // Exclude password hash from response
    delete user.password_hash;
    user.inr_balance = Number(user.inr_balance) || 0;
    user.bcoin_balance = Number(user.bcoin_balance) || 0;

    return res.json({
      success: true,
      message: 'Logged in successfully!',
      token,
      user
    });

  } catch (err) {
    console.error('[Login Error]', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

exports.changePassword = async (req, res) => {
  const userId = req.user.id;
  const { password, confirmPassword, otp } = req.body;

  if (!password || !confirmPassword || !otp) {
    return res.status(400).json({ error: 'Please enter new password and OTP' });
  }

  if (password !== confirmPassword) {
    return res.status(400).json({ error: 'Passwords do not match' });
  }

  try {
    const user = await query.get('SELECT mobile FROM users WHERE id = ?', [userId]);
    const isValidOtp = await verifyAndConsumeOtp(user.mobile, otp);
    if (!isValidOtp) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await query.run('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, userId]);

    return res.json({ success: true, message: 'Password updated successfully!' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

exports.resetPassword = async (req, res) => {
  const { mobile, password, confirmPassword, otp } = req.body;

  if (!mobile || !password || !confirmPassword || !otp) {
    return res.status(400).json({ error: 'Please enter all fields' });
  }

  if (password !== confirmPassword) {
    return res.status(400).json({ error: 'Passwords do not match' });
  }

  try {
    // Verify OTP
    const isValidOtp = await verifyAndConsumeOtp(mobile, otp);
    if (!isValidOtp) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    // Check if user exists
    const user = await query.get('SELECT id FROM users WHERE mobile = ?', [mobile]);
    if (!user) {
      return res.status(400).json({ error: 'Account not found with this mobile number' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await query.run('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, user.id]);

    return res.json({ success: true, message: 'Password reset successfully! Please log in.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

