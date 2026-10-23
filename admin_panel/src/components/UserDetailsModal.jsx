import React, { useState } from 'react';

export default function UserDetailsModal({
  isOpen,
  onClose,
  data,
  loading = false,
  theme = 'dark'
}) {
  const [activeTab, setActiveTab] = useState('overview');

  if (!isOpen || !data || (!data.user && !data.id)) return null;

  const user = data.user || data;
  const isDark = theme === 'dark';
  const initial = user.username?.charAt(0).toUpperCase() || user.uid?.charAt(0).toUpperCase() || 'U';
  const isBlocked = !!user.is_blocked;

  const bankAccounts = data.bank_accounts || data.banks || [];
  const deposits = data.deposits || [];
  const withdrawals = data.withdrawals || [];
  const team = data.team || data.downline || [];
  const plans = data.plans || data.activePlans || [];

  const tabs = [
    { id: 'overview', label: 'Overview', icon: 'fa-user' },
    { id: 'banks', label: `Bank Accounts (${bankAccounts.length})`, icon: 'fa-university' },
    { id: 'deposits', label: `Deposits (${deposits.length})`, icon: 'fa-arrow-circle-down' },
    { id: 'withdrawals', label: `Withdrawals (${withdrawals.length})`, icon: 'fa-arrow-circle-up' },
    { id: 'team', label: `Downline (${team.length})`, icon: 'fa-users' },
    { id: 'plans', label: `Active Plans (${plans.length})`, icon: 'fa-layer-group' }
  ];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-md p-4">
      <div
        className={`w-full max-w-4xl max-h-[90vh] flex flex-col rounded-3xl shadow-2xl border transition-all duration-300 overflow-hidden ${
          isDark ? 'bg-[#131427] border-[#1b1c34] text-white' : 'bg-white border-slate-200 text-slate-800'
        }`}
      >
        {/* Header */}
        <div
          className={`px-6 py-4 border-b flex justify-between items-center ${
            isDark ? 'border-[#1b1c34] bg-[#16172e]' : 'border-slate-100 bg-slate-50'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-600/20 text-indigo-500 flex items-center justify-center font-black text-sm">
              {initial}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-extrabold uppercase tracking-wider">
                  {user.username || 'User Profile'}
                </h3>
                <span className="font-mono text-[11px] bg-indigo-500/10 text-indigo-400 px-2 py-0.5 rounded-full font-bold">
                  UID: {user.uid}
                </span>
                {isBlocked ? (
                  <span className="text-[10px] bg-rose-500/10 text-rose-500 px-2 py-0.5 rounded-full font-bold uppercase">
                    Blocked
                  </span>
                ) : (
                  <span className="text-[10px] bg-emerald-500/10 text-emerald-500 px-2 py-0.5 rounded-full font-bold uppercase">
                    Active
                  </span>
                )}
              </div>
              <p className="text-[10px] text-slate-400 mt-0.5">Mobile: {user.mobile}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-200 hover:bg-white/5 text-sm font-bold transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Tab Navigation */}
        <div
          className={`flex border-b px-6 gap-2 overflow-x-auto text-xs font-bold ${
            isDark ? 'border-[#1b1c34] bg-[#101124]' : 'border-slate-100 bg-slate-50/50'
          }`}
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`py-3 px-3.5 border-b-2 flex items-center gap-1.5 transition-all whitespace-nowrap active:scale-95 ${
                activeTab === tab.id
                  ? 'border-indigo-500 text-indigo-400 font-extrabold'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <i className={`fas ${tab.icon} text-[11px]`} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 max-h-[58vh]">
          {loading ? (
            <div className="text-center py-16 text-xs text-slate-400 select-none">
              <i className="fas fa-spinner fa-spin text-2xl text-indigo-500 block mb-2" />
              Loading user details & records...
            </div>
          ) : (
            <>
              {/* TAB 1: OVERVIEW */}
              {activeTab === 'overview' && (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div
                      className={`p-4 rounded-2xl border ${
                        isDark ? 'bg-[#181931] border-[#1f203d]' : 'bg-slate-50 border-slate-200'
                      }`}
                    >
                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
                        INR Balance
                      </span>
                      <div className="text-lg font-black text-emerald-500 mt-1">
                        ₹{Number(user.inr_balance || 0).toFixed(2)}
                      </div>
                    </div>
                    <div
                      className={`p-4 rounded-2xl border ${
                        isDark ? 'bg-[#181931] border-[#1f203d]' : 'bg-slate-50 border-slate-200'
                      }`}
                    >
                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
                        T Coin Balance
                      </span>
                      <div className="text-lg font-black text-amber-500 mt-1">
                        ₹{Number(user.bcoin_balance || 0).toFixed(2)}
                      </div>
                    </div>
                    <div
                      className={`p-4 rounded-2xl border ${
                        isDark ? 'bg-[#181931] border-[#1f203d]' : 'bg-slate-50 border-slate-200'
                      }`}
                    >
                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
                        Total Earnings
                      </span>
                      <div className="text-lg font-black text-indigo-400 mt-1">
                        ₹{Number(user.total_earnings || 0).toFixed(2)}
                      </div>
                    </div>
                    <div
                      className={`p-4 rounded-2xl border ${
                        isDark ? 'bg-[#181931] border-[#1f203d]' : 'bg-slate-50 border-slate-200'
                      }`}
                    >
                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
                        Today Profit
                      </span>
                      <div className="text-lg font-black text-blue-400 mt-1">
                        ₹{Number(user.today_profit || 0).toFixed(2)}
                      </div>
                    </div>
                  </div>

                  <div
                    className={`p-5 rounded-2xl border ${
                      isDark ? 'bg-[#181931]/60 border-[#1f203d]' : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <h4 className="text-xs font-black uppercase tracking-wider text-slate-400 mb-4">
                      Profile & Account Info
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                      <div className="flex justify-between py-2 border-b border-slate-700/20">
                        <span className="text-slate-400">UID:</span>
                        <span className="font-mono font-bold">{user.uid || '---'}</span>
                      </div>
                      <div className="flex justify-between py-2 border-b border-slate-700/20">
                        <span className="text-slate-400">Mobile Number:</span>
                        <span className="font-bold">{user.mobile || '---'}</span>
                      </div>
                      <div className="flex justify-between py-2 border-b border-slate-700/20">
                        <span className="text-slate-400">Invite Code:</span>
                        <span className="font-mono font-bold text-amber-400">
                          {user.invite_code || user.ref_code || '---'}
                        </span>
                      </div>
                      <div className="flex justify-between py-2 border-b border-slate-700/20">
                        <span className="text-slate-400">Invited By (Parent):</span>
                        <span className="font-mono font-bold text-indigo-400">
                          {user.invited_by || (data.parentUser ? data.parentUser.uid : 'None')}
                        </span>
                      </div>
                      <div className="flex justify-between py-2 border-b border-slate-700/20">
                        <span className="text-slate-400">Registered Date:</span>
                        <span className="font-bold text-slate-300">
                          {user.created_at ? new Date(user.created_at).toLocaleString('en-IN') : '---'}
                        </span>
                      </div>
                      <div className="flex justify-between py-2 border-b border-slate-700/20">
                        <span className="text-slate-400">Account Access:</span>
                        <span className={`font-bold ${user.is_blocked ? 'text-rose-500' : 'text-emerald-500'}`}>
                          {user.is_blocked ? 'BLOCKED' : 'ACTIVE / UNLOCKED'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: BANKS */}
              {activeTab === 'banks' && (
                <div className="space-y-3">
                  {bankAccounts.length === 0 ? (
                    <div className="text-center py-12 text-xs text-slate-500 font-bold uppercase tracking-wider">
                      No bank accounts or UPI IDs linked for this user.
                    </div>
                  ) : (
                    bankAccounts.map((b, idx) => (
                      <div
                        key={b.id || idx}
                        className={`p-4 rounded-2xl border flex flex-col md:flex-row justify-between items-start md:items-center gap-3 ${
                          isDark ? 'bg-[#181931] border-[#1f203d]' : 'bg-slate-50 border-slate-200'
                        }`}
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm text-indigo-400">
                              {b.bank_name || 'Bank Account'}
                            </span>
                            <span className="text-[9px] bg-emerald-500/10 text-emerald-500 px-2 py-0.5 rounded font-bold uppercase">
                              {b.status || 'Active'}
                            </span>
                          </div>
                          <p className="text-xs text-slate-300">
                            Holder: <strong className="text-white">{b.account_holder || '---'}</strong>
                          </p>
                          <div className="flex flex-wrap gap-4 text-xs text-slate-400">
                            <span>
                              A/C: <strong className="font-mono text-slate-200">{b.account_number || '---'}</strong>
                            </span>
                            <span>
                              IFSC: <strong className="font-mono text-slate-200">{b.ifsc_code || b.ifsc || '---'}</strong>
                            </span>
                            {b.upi_id && (
                              <span>
                                UPI: <strong className="font-mono text-blue-400">{b.upi_id}</strong>
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* TAB 3: DEPOSITS */}
              {activeTab === 'deposits' && (
                <div className="space-y-3">
                  {deposits.length === 0 ? (
                    <div className="text-center py-12 text-xs text-slate-500 font-bold uppercase tracking-wider">
                      No deposit transactions recorded.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr
                            className={`border-b font-bold uppercase tracking-wider ${
                              isDark ? 'border-[#1b1c34] text-slate-400' : 'border-slate-200 text-slate-500'
                            }`}
                          >
                            <th className="py-2.5">Date</th>
                            <th className="py-2.5">Order ID</th>
                            <th className="py-2.5">Type/Asset</th>
                            <th className="py-2.5">Amount</th>
                            <th className="py-2.5">UTR Reference</th>
                            <th className="py-2.5 text-right">Status</th>
                          </tr>
                        </thead>
                        <tbody className={`divide-y ${isDark ? 'divide-[#1b1c34]/50' : 'divide-slate-100'}`}>
                          {deposits.map((d, idx) => (
                            <tr key={d.id || d.order_id || idx} className="hover:bg-white/5 transition-colors">
                              <td className="py-2.5 text-slate-400">
                                {d.created_at ? new Date(d.created_at).toLocaleString('en-IN') : '---'}
                              </td>
                              <td className="py-2.5 font-mono text-slate-300">{d.order_id}</td>
                              <td className="py-2.5 font-bold text-slate-300">{d.asset_type || d.asset || 'INR'}</td>
                              <td className="py-2.5 font-extrabold text-emerald-400">
                                ₹{Number(d.amount).toLocaleString('en-IN')}
                              </td>
                              <td className="py-2.5 font-mono text-blue-400">{d.utr || d.utr_number || 'N/A'}</td>
                              <td className="py-2.5 text-right">
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                    d.status === 'Completed'
                                      ? 'bg-emerald-500/10 text-emerald-500'
                                      : d.status === 'Confirming'
                                      ? 'bg-amber-500/10 text-amber-500'
                                      : 'bg-rose-500/10 text-rose-500'
                                  }`}
                                >
                                  {d.status}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 4: WITHDRAWALS */}
              {activeTab === 'withdrawals' && (
                <div className="space-y-3">
                  {withdrawals.length === 0 ? (
                    <div className="text-center py-12 text-xs text-slate-500 font-bold uppercase tracking-wider">
                      No withdrawal records found.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr
                            className={`border-b font-bold uppercase tracking-wider ${
                              isDark ? 'border-[#1b1c34] text-slate-400' : 'border-slate-200 text-slate-500'
                            }`}
                          >
                            <th className="py-2.5">Date</th>
                            <th className="py-2.5">Description</th>
                            <th className="py-2.5 text-right">Amount</th>
                          </tr>
                        </thead>
                        <tbody className={`divide-y ${isDark ? 'divide-[#1b1c34]/50' : 'divide-slate-100'}`}>
                          {withdrawals.map((w, idx) => (
                            <tr key={w.id || idx} className="hover:bg-white/5 transition-colors">
                              <td className="py-2.5 text-slate-400 font-semibold">
                                {w.created_at ? new Date(w.created_at).toLocaleString('en-IN') : '---'}
                              </td>
                              <td className="py-2.5 text-slate-300 font-semibold">{w.description || 'Withdrawal'}</td>
                              <td className="py-2.5 text-right font-extrabold text-rose-500">
                                ₹{Math.abs(Number(w.amount || 0)).toFixed(2)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 5: DOWNLINE (TEAM) */}
              {activeTab === 'team' && (
                <div className="space-y-3">
                  {team.length === 0 ? (
                    <div className="text-center py-12 text-xs text-slate-500 font-bold uppercase tracking-wider">
                      No downline team members referred yet.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr
                            className={`border-b font-bold uppercase tracking-wider ${
                              isDark ? 'border-[#1b1c34] text-slate-400' : 'border-slate-200 text-slate-500'
                            }`}
                          >
                            <th className="py-2.5">UID</th>
                            <th className="py-2.5">Mobile</th>
                            <th className="py-2.5">INR Balance</th>
                            <th className="py-2.5">T Coin</th>
                            <th className="py-2.5 text-right">Joined Date</th>
                          </tr>
                        </thead>
                        <tbody className={`divide-y ${isDark ? 'divide-[#1b1c34]/50' : 'divide-slate-100'}`}>
                          {team.map((m, idx) => (
                            <tr key={m.id || idx} className="hover:bg-white/5 transition-colors">
                              <td className="py-2.5 font-mono font-bold text-indigo-400">{m.uid}</td>
                              <td className="py-2.5 font-bold text-slate-200">{m.mobile}</td>
                              <td className="py-2.5 text-emerald-400 font-bold">
                                ₹{Number(m.inr_balance || 0).toFixed(2)}
                              </td>
                              <td className="py-2.5 text-amber-400 font-bold">
                                ₹{Number(m.bcoin_balance || 0).toFixed(2)}
                              </td>
                              <td className="py-2.5 text-right text-slate-400">
                                {m.created_at ? new Date(m.created_at).toLocaleDateString('en-IN') : '---'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 6: ACTIVE PLANS */}
              {activeTab === 'plans' && (
                <div className="space-y-3">
                  {plans.length === 0 ? (
                    <div className="text-center py-12 text-xs text-slate-500 font-bold uppercase tracking-wider">
                      No active or purchased plans found.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr
                            className={`border-b font-bold uppercase tracking-wider ${
                              isDark ? 'border-[#1b1c34] text-slate-400' : 'border-slate-200 text-slate-500'
                            }`}
                          >
                            <th className="py-2.5">Order ID</th>
                            <th className="py-2.5">Amount</th>
                            <th className="py-2.5">Expected Income</th>
                            <th className="py-2.5">Total Quota</th>
                            <th className="py-2.5 text-right">Status</th>
                          </tr>
                        </thead>
                        <tbody className={`divide-y ${isDark ? 'divide-[#1b1c34]/50' : 'divide-slate-100'}`}>
                          {plans.map((p, idx) => (
                            <tr key={p.id || p.order_id || idx} className="hover:bg-white/5 transition-colors">
                              <td className="py-2.5 font-mono text-indigo-400">{p.order_id}</td>
                              <td className="py-2.5 font-bold text-white">
                                ₹{Number(p.amount).toLocaleString('en-IN')}
                              </td>
                              <td className="py-2.5 font-bold text-emerald-400">
                                +₹{Number(p.expected_income || 0).toFixed(2)}
                              </td>
                              <td className="py-2.5 font-bold text-amber-400">
                                ₹{Number(p.quota || p.amount).toFixed(2)}
                              </td>
                              <td className="py-2.5 text-right font-bold text-emerald-500 uppercase">{p.status}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div
          className={`px-6 py-4 border-t flex justify-end ${
            isDark ? 'border-[#1b1c34] bg-[#16172e]' : 'border-slate-100 bg-slate-50'
          }`}
        >
          <button
            onClick={onClose}
            className="px-6 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider bg-indigo-600 hover:bg-indigo-500 text-white active:scale-95 transition-all shadow-md shadow-indigo-600/20"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
