const admin = require('firebase-admin');
const { getMessaging } = require('firebase-admin/messaging');
const path = require('path');
const fs = require('fs');

const serviceAccountPath = path.join(__dirname, 'firebase-service-account.json');

let initialized = false;

// Helper to safely parse service account from env or file
function resolveServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      const raw = process.env.FIREBASE_SERVICE_ACCOUNT.trim();
      return raw.startsWith('{') ? JSON.parse(raw) : JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    } catch (err) {
      console.error('[Firebase] Failed to parse FIREBASE_SERVICE_ACCOUNT env:', err.message);
    }
  }

  if (process.env.FIREBASE_CONFIG) {
    try {
      const raw = process.env.FIREBASE_CONFIG.trim();
      if (raw.startsWith('{')) {
        return JSON.parse(raw);
      }
    } catch (err) {
      console.error('[Firebase] Failed to parse FIREBASE_CONFIG env:', err.message);
    }
  }

  if (fs.existsSync(serviceAccountPath)) {
    try {
      return require(serviceAccountPath);
    } catch (err) {
      console.error('[Firebase] Failed to read firebase-service-account.json file:', err.message);
    }
  }

  return null;
}

const serviceAccount = resolveServiceAccount();

if (serviceAccount) {
  try {
    const apps = typeof admin.getApps === 'function' ? admin.getApps() : (admin.apps || []);
    if (!apps.length) {
      admin.initializeApp({
        credential: admin.cert(serviceAccount)
      });
    }
    initialized = true;
    console.log('[Firebase] Admin SDK FCM Push Notification service initialized successfully. Project:', serviceAccount.project_id);
  } catch (err) {
    console.error('[Firebase] Failed to initialize Firebase Messaging:', err.message);
  }
} else {
  console.log('[Firebase] No Firebase credentials found. Push notifications will run in mock mode.');
}

/**
 * FCM Push Notification Dispatcher (Strictly for Notifications only)
 */
async function sendPushNotification(user, title, body, data = {}) {
  if (!user) return;
  if (!initialized) {
    console.log(`[Firebase Notification Mock] Push to User ${user.username || user.mobile} (ID: ${user.id}): "${title}" - "${body}"`);
    return;
  }

  if (!user.fcm_tokens || user.fcm_tokens.length === 0) {
    return;
  }

  const tokens = (Array.isArray(user.fcm_tokens) ? user.fcm_tokens : [user.fcm_tokens]).filter(t => t && typeof t === 'string' && t.trim().length > 0);
  if (tokens.length === 0) return;

  const stringData = {};
  for (const [k, v] of Object.entries(data)) {
    stringData[k] = String(v);
  }

  const message = {
    notification: { title, body },
    data: stringData,
    tokens
  };

  try {
    const response = await getMessaging().sendEachForMulticast(message);
    console.log(`[Firebase FCM] Notification sent to user ${user.id}: ${response.successCount} success, ${response.failureCount} failed.`);
  } catch (err) {
    console.error('[Firebase FCM] Error sending push notification:', err.message);
  }
}

module.exports = {
  admin,
  isFirebaseConnected: () => initialized,
  sendPushNotification
};
