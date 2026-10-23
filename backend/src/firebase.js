const admin = require('firebase-admin');
const { getMessaging } = require('firebase-admin/messaging');
const { getFirestore } = require('firebase-admin/firestore');
const path = require('path');
const fs = require('fs');

const serviceAccountPath = path.join(__dirname, 'firebase-service-account.json');

let initialized = false;
let firestoreDb = null;

// Helper to safely parse service account from env or file
function resolveServiceAccount() {
  // 1. Environment variable: FIREBASE_SERVICE_ACCOUNT
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      const raw = process.env.FIREBASE_SERVICE_ACCOUNT.trim();
      return raw.startsWith('{') ? JSON.parse(raw) : JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    } catch (err) {
      console.error('[Firebase] Failed to parse FIREBASE_SERVICE_ACCOUNT env:', err.message);
    }
  }

  // 2. Environment variable: FIREBASE_CONFIG
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

  // 3. Local JSON file on disk
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
    firestoreDb = getFirestore();
    firestoreDb.settings({ ignoreUndefinedProperties: true });
    console.log('[Firebase] Admin SDK & Firestore database connected successfully. Project:', serviceAccount.project_id);
  } catch (err) {
    console.error('[Firebase] Failed to initialize Firebase:', err.message);
  }
} else {
  console.warn('[Firebase] No Firebase credentials found. Running in local file database mode.');
}

/**
 * Push Notification Dispatcher
 */
async function sendPushNotification(user, title, body, data = {}) {
  if (!user) return;
  if (!initialized) {
    console.log(`[Firebase Mock] Push to User ${user.username} (ID: ${user.id}): "${title}" - "${body}"`);
    return;
  }

  if (!user.fcm_tokens || user.fcm_tokens.length === 0) {
    return;
  }

  const tokens = user.fcm_tokens.filter(t => t && t.trim().length > 0);
  if (tokens.length === 0) return;

  const message = {
    notification: { title, body },
    data,
    tokens
  };

  try {
    const response = await getMessaging().sendEachForMulticast(message);
    console.log(`[Firebase] Multicast sent: ${response.successCount} success, ${response.failureCount} failed.`);
  } catch (err) {
    console.error('[Firebase] Error sending multicast message:', err.message);
  }
}

/**
 * Firestore Cloud Database Synchronizer
 * Configurable prefix (default: gopay_)
 */
const PREFIX = process.env.FIREBASE_PREFIX || 'gopay_';

const TABLE_DEFINITIONS = [
  { key: 'users', coll: `${PREFIX}users`, idField: 'id' },
  { key: 'orders', coll: `${PREFIX}orders`, idField: 'id' },
  { key: 'bank_accounts', coll: `${PREFIX}bank_accounts`, idField: 'id' },
  { key: 'transactions', coll: `${PREFIX}transactions`, idField: 'id' },
  { key: 'withdrawals', coll: `${PREFIX}withdrawals`, idField: 'id' },
  { key: 'disputes', coll: `${PREFIX}disputes`, idField: 'id' },
  { key: 'user_tasks', coll: `${PREFIX}user_tasks`, idField: 'id' },
  { key: 'messages', coll: `${PREFIX}messages`, idField: 'id' }
];

// Database storage is now fully migrated to Supabase. Firebase is reserved exclusively for FCM Push Notifications.
async function loadFromFirestore() {
  return null;
}

async function syncToFirestore(dbData, idTrackers) {
  return;
}

module.exports = {
  admin,
  firestoreDb,
  isFirebaseConnected: () => !!firestoreDb,
  sendPushNotification,
  loadFromFirestore,
  syncToFirestore
};
