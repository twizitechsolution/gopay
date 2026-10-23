// High-performance in-memory cache for admin dashboard endpoints
// Prevents redundant round-trips and eliminates UI lag

const store = new Map();

const adminCache = {
  get: (key) => {
    const item = store.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      store.delete(key);
      return null;
    }
    return item.data;
  },

  set: (key, data, ttlMs = 10000) => {
    store.set(key, {
      data,
      expiresAt: Date.now() + ttlMs
    });
  },

  delete: (key) => {
    store.delete(key);
  },

  clear: () => {
    store.clear();
  },

  invalidatePrefix: (prefix) => {
    for (const key of store.keys()) {
      if (key.startsWith(prefix)) {
        store.delete(key);
      }
    }
  }
};

module.exports = adminCache;
