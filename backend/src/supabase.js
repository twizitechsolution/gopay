// Gopay Platform - Supabase Deprecation Bridge
// Supabase is completely removed from Gopay. All data persistence is handled natively by MySQL (gopay_db).
module.exports = {
  supabase: null,
  isSupabaseConnected: () => false,
  fetchAll: async () => []
};
