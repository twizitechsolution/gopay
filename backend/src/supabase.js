const dns = require('dns');
try { dns.setDefaultResultOrder('ipv4first'); } catch (_) {}
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || 'https://hlhxkknqhiksjyilpmdc.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || 'sb_secret_WxtGqJ3MBea0VHu2alBYbA_Z21GMMp0';

async function fetchWithRetry(url, options = {}, retries = 3, backoff = 150) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fetch(url, options);
    } catch (err) {
      if (attempt === retries) throw err;
      console.warn(`[Supabase Fetch] Attempt ${attempt} failed: ${err.message}. Retrying in ${backoff}ms...`);
      await new Promise(r => setTimeout(r, backoff));
      backoff *= 2;
    }
  }
}

let supabase = null;

try {
  if (supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
      global: { fetch: fetchWithRetry }
    });
    console.log('[Supabase] Client connected successfully to:', supabaseUrl);
  }
} catch (err) {
  console.error('[Supabase] Initialization error:', err.message);
}

async function fetchAll(table, select = '*', orderCol = null, ascending = false, maxRecords = 20000, filterFn = null) {
  if (!supabase) return [];
  const pageSize = 1000;
  const allRows = [];
  let from = 0;
  while (from < maxRecords) {
    const to = from + pageSize - 1;
    let q = supabase.from(table).select(select).range(from, to);
    if (orderCol) {
      q = q.order(orderCol, { ascending });
    }
    if (typeof filterFn === 'function') {
      q = filterFn(q);
    }
    const res = await q;
    if (res.error) {
      console.warn(`[fetchAll] Warning on ${table} range ${from}-${to}:`, res.error.message);
      break;
    }
    const rows = res.data || [];
    allRows.push(...rows);
    if (rows.length < pageSize) {
      break;
    }
    from += pageSize;
  }
  return allRows;
}

module.exports = {
  supabase,
  isSupabaseConnected: () => !!supabase,
  fetchAll
};
