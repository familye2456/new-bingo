import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi, gameApi } from '../../services/api';
import { useNavigate } from 'react-router-dom';

interface UserRecord { id: string; status: string; paymentType: string; balance: number; createdAt: string; }
interface Game { id: string; status: string; betAmount: number; cartelaCount: number; prizePool: number; createdAt: string; gameNumber?: number; }

const StatCard: React.FC<{
  label: string; value: string | number; sub?: string;
  icon: React.ReactNode; gradient: string; onClick?: () => void;
}> = ({ label, value, sub, icon, gradient, onClick }) => (
  <button
    onClick={onClick}
    className={`rounded-2xl p-5 text-left w-full transition-transform hover:-translate-y-0.5 hover:shadow-lg ${gradient}`}
  >
    <div className="flex items-start justify-between mb-3">
      <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center text-white">
        {icon}
      </div>
    </div>
    <div className="text-2xl font-bold text-white">{value}</div>
    <div className="text-sm text-white/80 mt-0.5">{label}</div>
    {sub && <div className="text-xs text-white/60 mt-1">{sub}</div>}
  </button>
);

const STATUS_STYLES: Record<string, string> = {
  active:   'bg-emerald-100 text-emerald-700',
  pending:  'bg-amber-100 text-amber-700',
  finished: 'bg-blue-100 text-blue-700',
  cancelled:'bg-gray-100 text-gray-500',
};

export const AdminOverview: React.FC = () => {
  const navigate = useNavigate();

  const { data: users = [], isLoading: loadingUsers } = useQuery<UserRecord[]>({
    queryKey: ['admin-users'],
    queryFn: () => adminApi.listUsers().then((r) => r.data.data),
  });

  const { data: games = [], isLoading: loadingGames } = useQuery<Game[]>({
    queryKey: ['games'],
    queryFn: () => gameApi.list().then((r) => r.data.data),
  });

  const activeUsers   = users.filter((u) => u.status === 'active').length;
  const prepaidUsers  = users.filter((u) => u.paymentType === 'prepaid');
  const postpaidCount = users.filter((u) => u.paymentType === 'postpaid').length;
  const totalBalance  = prepaidUsers.reduce((sum, u) => sum + Number(u.balance), 0);
  const activeGames   = games.filter((g) => g.status === 'active').length;
  const totalPrizePool = games.reduce((s, g) => s + Number(g.prizePool), 0);

  const recentGames = [...games]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 8);

  const recentUsers = [...users]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3 sm:gap-4">
        <StatCard
          label="Total Users" value={users.length}
          gradient="bg-gradient-to-br from-blue-500 to-blue-600"
          onClick={() => navigate('/admin/users')}
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>}
        />
        <StatCard
          label="Active Users" value={activeUsers}
          sub={`${users.length ? Math.round(activeUsers / users.length * 100) : 0}% of total`}
          gradient="bg-gradient-to-br from-emerald-500 to-emerald-600"
          onClick={() => navigate('/admin/users')}
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
        />
        <StatCard
          label="Prepaid" value={prepaidUsers.length}
          gradient="bg-gradient-to-br from-violet-500 to-violet-600"
          onClick={() => navigate('/admin/packages')}
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>}
        />
        <StatCard
          label="Postpaid" value={postpaidCount}
          gradient="bg-gradient-to-br from-orange-500 to-orange-600"
          onClick={() => navigate('/admin/users')}
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>}
        />
        <StatCard
          label="Active Games" value={activeGames}
          gradient="bg-gradient-to-br from-amber-500 to-amber-600"
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 sm:gap-6">
        {/* Recent Games */}
        <div className="xl:col-span-2 bg-white rounded-2xl shadow-sm border border-gray-100">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-800">Recent Games</h2>
            <span className="text-xs text-gray-400">{games.length} total</span>
          </div>
          {loadingGames ? (
            <div className="py-12 text-center text-gray-400 text-sm">Loading...</div>
          ) : recentGames.length === 0 ? (
            <div className="py-12 text-center text-gray-400 text-sm">No games yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-50">
                    {['Game', 'Status', 'Bet', 'Cartelas', 'Prize Pool', 'Date'].map((h) => (
                      <th key={h} className="text-left px-6 py-3 text-xs font-medium text-gray-400 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {recentGames.map((g) => (
                    <tr key={g.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-6 py-3.5 font-mono text-xs text-gray-500">
                        #{g.gameNumber ?? g.id.slice(0, 8)}
                      </td>
                      <td className="px-6 py-3.5">
                        <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${STATUS_STYLES[g.status] ?? 'bg-gray-100 text-gray-500'}`}>
                          {g.status}
                        </span>
                      </td>
                      <td className="px-6 py-3.5 text-gray-700">${Number(g.betAmount).toFixed(2)}</td>
                      <td className="px-6 py-3.5 text-gray-700">{g.cartelaCount}</td>
                      <td className="px-6 py-3.5 font-medium text-emerald-600">${Number(g.prizePool).toFixed(2)}</td>
                      <td className="px-6 py-3.5 text-gray-400 text-xs">{new Date(g.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Recent Users + Summary */}
        <div className="space-y-4">
          {/* Summary card */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <h3 className="font-semibold text-gray-800 mb-4 text-sm">Financial Summary</h3>
            <div className="space-y-3">
              {[
                { label: 'Total Prize Pool (all games)', value: `${totalPrizePool.toFixed(2)}`, color: 'text-emerald-600' },
                { label: 'Prepaid Balance on Platform', value: `${totalBalance.toFixed(2)}`, color: 'text-blue-600' },
                { label: 'Games Played', value: games.filter(g => g.status === 'finished').length, color: 'text-gray-700' },
              ].map(({ label, value, color }) => (
                <div key={label} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <span className="text-xs text-gray-500">{label}</span>
                  <span className={`text-sm font-semibold ${color}`}>{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Recent users */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800 text-sm">New Users</h3>
              <button onClick={() => navigate('/admin/users')} className="text-xs text-blue-500 hover:text-blue-600">View all</button>
            </div>
            {loadingUsers ? (
              <div className="py-8 text-center text-gray-400 text-sm">Loading...</div>
            ) : (
              <div className="divide-y divide-gray-50">
                {recentUsers.map((u) => (
                  <div key={u.id} className="flex items-center gap-3 px-5 py-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
                      {(u as any).username?.[0]?.toUpperCase() ?? '?'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-gray-800 truncate">{(u as any).username}</div>
                      <div className="text-xs text-gray-400">{u.paymentType}</div>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${u.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                      {u.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
