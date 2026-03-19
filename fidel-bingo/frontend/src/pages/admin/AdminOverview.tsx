import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi, gameApi } from '../../services/api';
import { useNavigate } from 'react-router-dom';

interface UserRecord { id: string; status: string; paymentType: string; balance: number; }
interface Game { id: string; status: string; betAmount: number; cartelaCount: number; prizePool: number; createdAt: string; }

export const AdminOverview: React.FC = () => {
  const navigate = useNavigate();

  const { data: users = [] } = useQuery<UserRecord[]>({
    queryKey: ['admin-users'],
    queryFn: () => adminApi.listUsers().then((r) => r.data.data),
  });

  const { data: games = [] } = useQuery<Game[]>({
    queryKey: ['games'],
    queryFn: () => gameApi.list().then((r) => r.data.data),
  });

  const activeUsers   = users.filter((u) => u.status === 'active').length;
  const prepaidUsers  = users.filter((u) => u.paymentType === 'prepaid');
  const postpaidCount = users.filter((u) => u.paymentType === 'postpaid').length;
  const totalBalance  = prepaidUsers.reduce((sum, u) => sum + Number(u.balance), 0);
  const activeGames   = games.filter((g) => g.status === 'active').length;

  const stats = [
    { label: 'Total Users',    value: users.length,          color: 'bg-blue-50   text-blue-600',   onClick: () => navigate('/admin/users') },
    { label: 'Active Users',   value: activeUsers,           color: 'bg-green-50  text-green-600',  onClick: () => navigate('/admin/users') },
    { label: 'Prepaid',        value: prepaidUsers.length,   color: 'bg-purple-50 text-purple-600', onClick: () => navigate('/admin/packages') },
    { label: 'Postpaid',       value: postpaidCount,         color: 'bg-orange-50 text-orange-600', onClick: () => navigate('/admin/users') },
    { label: 'Active Games',   value: activeGames,           color: 'bg-yellow-50 text-yellow-600', onClick: () => navigate('/admin/cartelas') },
    { label: 'Total Balance',  value: `$${totalBalance.toFixed(2)}`, color: 'bg-teal-50 text-teal-600', onClick: () => navigate('/admin/packages') },
  ];

  const recentGames = [...games].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 5);

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-6">Dashboard</h1>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
        {stats.map(({ label, value, color, onClick }) => (
          <button
            key={label}
            onClick={onClick}
            className={`rounded-xl p-5 text-left transition-opacity hover:opacity-80 ${color}`}
          >
            <div className="text-3xl font-bold">{value}</div>
            <div className="text-sm mt-1 opacity-75">{label}</div>
          </button>
        ))}
      </div>

      {/* Recent games */}
      <h2 className="text-base font-semibold mb-3 text-gray-700">Recent Games</h2>
      <div className="bg-white rounded-xl shadow overflow-hidden">
        {recentGames.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm">No games yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                {['Game ID', 'Status', 'Bet', 'Cartelas', 'Prize Pool', 'Date'].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-gray-600 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {recentGames.map((g) => (
                <tr key={g.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">#{g.gameNumber ?? g.id.slice(0, 8)}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      g.status === 'active'   ? 'bg-green-100 text-green-700' :
                      g.status === 'pending'  ? 'bg-yellow-100 text-yellow-700' :
                      g.status === 'finished' ? 'bg-blue-100 text-blue-700' :
                      'bg-gray-100 text-gray-500'
                    }`}>{g.status}</span>
                  </td>
                  <td className="px-4 py-3">${Number(g.betAmount).toFixed(2)}</td>
                  <td className="px-4 py-3">{g.cartelaCount}</td>
                  <td className="px-4 py-3 text-green-700">${Number(g.prizePool).toFixed(2)}</td>
                  <td className="px-4 py-3 text-gray-400">{new Date(g.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
