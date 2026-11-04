import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '../../services/api';

interface UserRecord {
  id: string;
  username: string;
  role: string;
  allowedPatterns?: string[] | null;
}

/**
 * Special patterns that can optionally count as "one line" in line1/line2/line3 checks.
 * Regular rows, columns, and both diagonals always count and are not configurable.
 */
const COUNTABLE_PATTERNS: { value: string; label: string; desc: string }[] = [
  { value: 'fourCorners',   label: 'Four Corners',   desc: 'All 4 corner cells marked' },
  { value: 'roundFree',     label: 'Round Free',     desc: '8 cells surrounding the center' },
  { value: 'centerDiamond', label: 'Center Diamond', desc: '4 diagonal neighbors of center' },
  { value: 'centerCross',   label: 'Center Cross',   desc: '4 orthogonal neighbors of center' },
];

const ALL_SPECIAL = new Set(COUNTABLE_PATTERNS.map(p => p.value));

const inputCls =
  'border border-gray-200 rounded-xl px-3.5 py-2.5 w-full text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-colors';

export const PatternConfig: React.FC = () => {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [editUserId, setEditUserId] = useState<string | null>(null);
  // draft = which special patterns count as a line for the user being edited
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<string | null>(null);

  const { data: users = [], isLoading } = useQuery<UserRecord[]>({
    queryKey: ['admin-users'],
    queryFn: () => adminApi.listUsers().then((r) => r.data.data),
  });

  const saveMutation = useMutation({
    mutationFn: ({ userId, patterns }: { userId: string; patterns: string[] | null }) =>
      adminApi.setWinPatterns(userId, patterns),
    onSuccess: (_, { userId }) => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      setSaved(userId);
      setTimeout(() => setSaved(null), 2500);
      setEditUserId(null);
    },
  });

  const players = users.filter(
    (u) =>
      u.role === 'player' &&
      u.username.toLowerCase().includes(search.toLowerCase()),
  );

  // null = all allowed (default). Pre-fill editor with all checked if no config yet.
  const openEdit = (u: UserRecord) => {
    setEditUserId(u.id);
    const initial = u.allowedPatterns ?? [...ALL_SPECIAL];
    setDraft(new Set(initial));
  };

  const togglePattern = (p: string) => {
    setDraft((prev) => {
      const next = new Set(prev);
      next.has(p) ? next.delete(p) : next.add(p);
      return next;
    });
  };

  const handleSave = (userId: string) => {
    // If all special patterns are checked it's the same as default — save null
    const allChecked = COUNTABLE_PATTERNS.every(p => draft.has(p.value));
    saveMutation.mutate({ userId, patterns: allChecked ? null : [...draft] });
  };

  const handleReset = (userId: string) => {
    saveMutation.mutate({ userId, patterns: null });
  };

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-800">Line Count Configuration</h2>
        <p className="text-sm text-gray-500 mt-1">
          Choose which special patterns count as <span className="font-medium text-gray-700">"one line"</span> for each player.
          By default all of them count. Uncheck a pattern to stop it from contributing to line1/line2/line3 wins for a specific user.
        </p>
        <p className="text-xs text-gray-400 mt-1.5">
          Rows, columns, and diagonals always count — they are not configurable.
        </p>
      </div>

      <input
        className={inputCls}
        placeholder="Search players…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {isLoading && (
        <div className="text-sm text-gray-400 text-center py-10">Loading…</div>
      )}

      {!isLoading && players.length === 0 && (
        <div className="text-sm text-gray-400 text-center py-10">No players found.</div>
      )}

      <div className="space-y-3">
        {players.map((u) => {
          const isEditing = editUserId === u.id;
          // null means all 4 special patterns count (default)
          const isDefault = !u.allowedPatterns || u.allowedPatterns.length === 0;
          const enabledPatterns = u.allowedPatterns ?? [...ALL_SPECIAL];
          const disabledPatterns = COUNTABLE_PATTERNS.filter(p => !enabledPatterns.includes(p.value));

          return (
            <div
              key={u.id}
              className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden"
            >
              {/* Header row */}
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
                    {u.username[0].toUpperCase()}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-gray-800">{u.username}</div>
                    <div className="text-xs text-gray-400">
                      {isDefault
                        ? 'All special patterns count (default)'
                        : `${disabledPatterns.length} pattern${disabledPatterns.length > 1 ? 's' : ''} excluded from line count`}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {saved === u.id && (
                    <span className="text-xs text-emerald-500 font-medium">Saved ✓</span>
                  )}
                  {!isDefault && !isEditing && (
                    <button
                      onClick={() => handleReset(u.id)}
                      disabled={saveMutation.isPending}
                      className="text-xs text-gray-400 hover:text-red-500 transition-colors px-2 py-1 rounded-lg hover:bg-red-50"
                    >
                      Reset to default
                    </button>
                  )}
                  <button
                    onClick={() => (isEditing ? setEditUserId(null) : openEdit(u))}
                    className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                      isEditing
                        ? 'bg-gray-100 text-gray-500'
                        : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                    }`}
                  >
                    {isEditing ? 'Cancel' : 'Configure'}
                  </button>
                </div>
              </div>

              {/* Read-only preview: show which ones are excluded */}
              {!isEditing && !isDefault && disabledPatterns.length > 0 && (
                <div className="px-4 pb-3 flex flex-wrap gap-1.5">
                  {disabledPatterns.map((p) => (
                    <span
                      key={p.value}
                      className="text-xs px-2.5 py-1 rounded-full bg-red-50 text-red-500 font-medium"
                    >
                      ✕ {p.label}
                    </span>
                  ))}
                </div>
              )}

              {/* Edit panel */}
              {isEditing && (
                <div className="border-t border-gray-100 px-4 py-4 space-y-4">
                  <p className="text-xs text-gray-500 bg-amber-50 border border-amber-200 rounded-xl p-3">
                    <span className="font-semibold text-amber-700">Checked = counts as one line</span> for{' '}
                    <span className="font-semibold text-gray-700">{u.username}</span>.
                    Uncheck a pattern to stop it from contributing to line counts.
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {COUNTABLE_PATTERNS.map((p) => {
                      const checked = draft.has(p.value);
                      return (
                        <label
                          key={p.value}
                          className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors select-none ${
                            checked
                              ? 'border-emerald-300 bg-emerald-50'
                              : 'border-red-200 bg-red-50'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => togglePattern(p.value)}
                            className="mt-0.5 accent-emerald-600 shrink-0 w-4 h-4"
                          />
                          <div>
                            <div className={`text-sm font-medium ${checked ? 'text-emerald-800' : 'text-red-700'}`}>
                              {p.label}
                            </div>
                            <div className="text-xs text-gray-400">{p.desc}</div>
                            <div className={`text-xs font-medium mt-0.5 ${checked ? 'text-emerald-600' : 'text-red-500'}`}>
                              {checked ? '✓ counts as one line' : '✕ does not count'}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-xs text-gray-400">
                      {draft.size === COUNTABLE_PATTERNS.length
                        ? 'All special patterns count (same as default)'
                        : draft.size === 0
                        ? 'No special patterns count — only rows/cols/diagonals'
                        : `${draft.size} of ${COUNTABLE_PATTERNS.length} special patterns count`}
                    </span>
                    <button
                      onClick={() => handleSave(u.id)}
                      disabled={saveMutation.isPending}
                      className="px-4 py-2 rounded-xl text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    >
                      {saveMutation.isPending ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
