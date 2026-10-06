import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi, gameApi } from '../../services/api';

const PATTERNS: { label: string; value: string }[] = [
  { label: 'One Line',     value: 'line1' },
  { label: 'Two Lines',    value: 'line2' },
  { label: 'Three Lines',  value: 'line3' },
  { label: 'Full House',   value: 'fullhouse' },
  { label: 'Four Corners', value: 'fourCorners' },
  { label: 'X Shape',      value: 'X' },
  { label: 'Plus',         value: 'plus' },
  { label: 'T Shape',      value: 'T' },
  { label: 'L Shape',      value: 'L' },
  { label: 'Frame',        value: 'frame' },
  { label: 'Round Free',   value: 'roundFree' },
];

interface UserRecord { id: string; username: string; }
interface CartelaRecord { id: string; cardNumber?: number; numbers?: number[]; isActive: boolean; }
interface RankEntry { cardNumber: number; callsNeeded: number; }
interface DetectResult {
  sequence: number[];
  generatedAt: string;
  winner: RankEntry | null;
  rankings: RankEntry[];
}
interface GlobalSeq { sequence: number[]; generatedAt: string; }

const inputCls = 'border border-gray-200 rounded-xl px-3.5 py-2.5 w-full text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-colors';

export const WinDetector: React.FC = () => {
  const qc = useQueryClient();
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedPattern, setSelectedPattern] = useState('line1');
  const [selectedCartelaIds, setSelectedCartelaIds] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<DetectResult | null>(null);

  const { data: users = [] } = useQuery<UserRecord[]>({
    queryKey: ['admin-users'],
    queryFn: () => adminApi.listUsers().then(r => r.data.data),
  });

  const { data: cartelas = [], isLoading: loadingCartelas } = useQuery<CartelaRecord[]>({
    queryKey: ['user-cartelas', selectedUserId],
    queryFn: () => adminApi.getUserCartelas(selectedUserId).then(r => r.data.data),
    enabled: !!selectedUserId,
  });

  const { data: globalSeq, isLoading: loadingSeq } = useQuery<GlobalSeq>({
    queryKey: ['global-sequence', selectedUserId],
    queryFn: () => gameApi.getGlobalSequence(selectedUserId || undefined).then(r => r.data.data),
  });

  const regenerateMutation = useMutation({
    mutationFn: () => gameApi.regenerateGlobalSequence(selectedUserId || undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['global-sequence', selectedUserId] });
      setResult(null);
    },
  });

  const detectMutation = useMutation({
    mutationFn: () => gameApi.detectWinner(Array.from(selectedCartelaIds), selectedPattern, selectedUserId || undefined),
    onSuccess: res => setResult(res.data.data),
  });

  const toggleCartela = (id: string) =>
    setSelectedCartelaIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const selectAll = () => setSelectedCartelaIds(new Set(cartelas.map(c => c.id)));
  const clearAll  = () => setSelectedCartelaIds(new Set());

  const bingo = ['B','I','N','G','O'];

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Win Detector</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            All games use the pre-generated sequence below. Select a user's cartelas and a win pattern to see exactly which card wins.
          </p>
        </div>
      </div>

      {/* Global Sequence card */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
          <div>
            <div className="font-semibold text-gray-800 text-sm">
              {selectedUserId
                ? `Next Game Sequence — ${users.find(u => u.id === selectedUserId)?.username ?? '...'}`
                : 'Pre-Generated Sequence (select a user to see their sequence)'}
            </div>
            {globalSeq && (
              <div className="text-xs text-gray-400 mt-0.5">
                Generated: {new Date(globalSeq.generatedAt).toLocaleString()}
                {' · '}This is the exact order numbers will be called in their next game.
              </div>
            )}
          </div>
          <button
            onClick={() => { if (window.confirm(`Regenerate sequence${selectedUserId ? ` for ${users.find(u=>u.id===selectedUserId)?.username}` : ''}? Their next game will use the new sequence.`)) regenerateMutation.mutate(); }}
            disabled={regenerateMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {regenerateMutation.isPending ? 'Regenerating…' : '🔀 Regenerate'}
          </button>
        </div>
        {loadingSeq ? (
          <div className="text-sm text-gray-400">Loading…</div>
        ) : globalSeq ? (
          <div>
            <div className="text-xs text-gray-500 mb-2">
              Numbers will be called in this exact order (1st → 75th):
            </div>
            <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
              {globalSeq.sequence.map((n, i) => (
                <div key={i} className="flex flex-col items-center">
                  <span className="text-[9px] text-gray-400 leading-none mb-0.5">{i + 1}</span>
                  <span
                    className="text-[11px] font-bold px-1.5 py-0.5 rounded-lg"
                    style={{ background: '#eef2ff', color: '#4338ca', minWidth: '26px', textAlign: 'center' }}>
                    {n}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-sm text-amber-500">No sequence generated yet. Click Regenerate to create one.</div>
        )}
      </div>

      {/* Controls */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* User picker */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Select User</label>
            <select
              value={selectedUserId}
              onChange={e => { setSelectedUserId(e.target.value); setSelectedCartelaIds(new Set()); setResult(null); }}
              className={inputCls}
            >
              <option value="">— choose a user —</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.username}</option>
              ))}
            </select>
          </div>
          {/* Pattern picker */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Win Pattern</label>
            <select
              value={selectedPattern}
              onChange={e => { setSelectedPattern(e.target.value); setResult(null); }}
              className={inputCls}
            >
              {PATTERNS.map(p => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Cartela selector */}
        {selectedUserId && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-600">
                Cartelas ({selectedCartelaIds.size} selected)
              </label>
              <div className="flex gap-2">
                <button onClick={selectAll} className="text-xs text-blue-600 hover:text-blue-800 font-medium">Select all</button>
                <span className="text-gray-300">|</span>
                <button onClick={clearAll} className="text-xs text-gray-400 hover:text-gray-600">Clear</button>
              </div>
            </div>
            {loadingCartelas ? (
              <div className="text-sm text-gray-400 py-4 text-center">Loading cartelas…</div>
            ) : cartelas.length === 0 ? (
              <div className="text-sm text-gray-400 py-4 text-center bg-gray-50 rounded-xl">No cartelas assigned to this user.</div>
            ) : (
              <div className="flex flex-wrap gap-2 p-3 bg-gray-50 rounded-xl max-h-36 overflow-y-auto">
                {[...cartelas].sort((a,b) => (a.cardNumber??0)-(b.cardNumber??0)).map(c => {
                  const sel = selectedCartelaIds.has(c.id);
                  return (
                    <button
                      key={c.id}
                      onClick={() => { toggleCartela(c.id); setResult(null); }}
                      className="w-11 h-11 rounded-xl font-black text-sm transition-all"
                      style={sel ? {
                        background: 'linear-gradient(145deg,#f59e0b,#d97706)',
                        color: '#fff',
                        border: '2px solid #fff',
                        boxShadow: '0 2px 8px rgba(245,158,11,0.4)',
                      } : {
                        background: '#e5e7eb',
                        color: '#374151',
                        border: '2px solid transparent',
                      }}
                    >
                      {c.cardNumber ?? '?'}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Detect button */}
        <button
          onClick={() => detectMutation.mutate()}
          disabled={selectedCartelaIds.size === 0 || detectMutation.isPending}
          className="w-full py-3 rounded-xl text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 transition-colors"
        >
          {detectMutation.isPending ? 'Detecting…' : '🔍 Detect Winner'}
        </button>
      </div>

      {/* Result */}
      {result && (
        <div className="space-y-4">
          {/* Winner highlight */}
          {result.winner ? (
            <div className="bg-gradient-to-r from-emerald-500 to-green-600 rounded-2xl p-5 flex items-center gap-4 shadow-lg">
              <div className="w-16 h-16 rounded-2xl bg-white/20 flex items-center justify-center text-white font-black text-2xl shrink-0">
                #{result.winner.cardNumber}
              </div>
              <div>
                <div className="text-white font-extrabold text-xl">Card #{result.winner.cardNumber} wins</div>
                <div className="text-white/80 text-sm mt-0.5">
                  Wins after call #{result.winner.callsNeeded} — number <strong>{result.sequence[result.winner.callsNeeded - 1]}</strong>
                </div>
                <div className="text-white/60 text-xs mt-1">
                  Pattern: {PATTERNS.find(p => p.value === selectedPattern)?.label}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-gray-100 rounded-2xl p-5 text-center text-gray-400 text-sm">
              No winner found with current cartelas and pattern.
            </div>
          )}

          {/* Full ranking table */}
          {result.rankings.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
                <span className="font-semibold text-gray-800 text-sm">Full Rankings</span>
                <span className="text-xs text-gray-400">{result.rankings.length} cartelas</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-50">
                    <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wide">Rank</th>
                    <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wide">Card</th>
                    <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wide">Wins on call #</th>
                    <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wide">Winning number</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {result.rankings.map((r, i) => (
                    <tr key={r.cardNumber} className={i === 0 ? 'bg-emerald-50/60' : 'hover:bg-gray-50/50'}>
                      <td className="px-5 py-3 font-bold text-gray-500">
                        {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                      </td>
                      <td className="px-5 py-3">
                        <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl font-black text-sm"
                          style={{ background: i === 0 ? 'linear-gradient(145deg,#f59e0b,#d97706)' : '#e5e7eb', color: i === 0 ? '#fff' : '#374151' }}>
                          {r.cardNumber}
                        </span>
                      </td>
                      <td className="px-5 py-3 font-semibold text-gray-700">{r.callsNeeded}</td>
                      <td className="px-5 py-3">
                        <span className="font-bold text-indigo-600">{result.sequence[r.callsNeeded - 1]}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Winning cartela grid preview */}
          {result.winner && (() => {
            const winCard = cartelas.find(c => c.cardNumber === result.winner!.cardNumber);
            if (!winCard?.numbers) return null;
            const calledUpToWin = new Set(result.sequence.slice(0, result.winner.callsNeeded));
            return (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                <div className="font-semibold text-gray-800 text-sm mb-3">
                  Card #{winCard.cardNumber} — numbers marked at win
                </div>
                <div className="inline-block">
                  <div className="grid grid-cols-5 gap-1 mb-1">
                    {bingo.map(l => (
                      <div key={l} className="w-10 h-10 flex items-center justify-center rounded-lg font-extrabold text-sm"
                        style={{ background: 'linear-gradient(145deg,#f59e0b,#d97706)', color: '#fff' }}>
                        {l}
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-5 gap-1">
                    {winCard.numbers.map((num, idx) => {
                      const isCenter = idx === 12;
                      const isMarked = isCenter || calledUpToWin.has(num);
                      return (
                        <div key={idx}
                          className="w-10 h-10 flex items-center justify-center rounded-lg font-bold text-xs"
                          style={isCenter
                            ? { background: 'linear-gradient(145deg,#f59e0b,#d97706)', color: '#fff' }
                            : isMarked
                            ? { background: '#6366f1', color: '#fff' }
                            : { background: '#f3f4f6', color: '#374151' }}>
                          {isCenter ? 'FREE' : num}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <p className="text-xs text-gray-400 mt-3">
                  Purple = called by call #{result.winner.callsNeeded}. Gold = free space.
                </p>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
};
