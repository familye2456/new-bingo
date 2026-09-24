import React, { useState, useEffect, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { userApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { useGameSettings } from '../../store/gameSettingsStore';
import { downloadVoiceSounds, getVoiceCacheStatus } from '../../services/db';
import { ALL_VOICE_CATEGORIES } from '../../store/gameSettingsStore';

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <label className="block text-xs font-medium mb-1.5" style={{ color: '#6b7280' }}>{label}</label>
    {children}
  </div>
);

const inputCls = 'w-full rounded-xl px-3.5 py-2.5 text-sm outline-none transition-all focus:ring-2 focus:ring-yellow-400/40';
const inputStyle = { background: '#0e1a35', border: '1px solid rgba(255,255,255,0.08)', color: '#e5e7eb' };
const disabledStyle = { background: '#0a1220', border: '1px solid rgba(255,255,255,0.05)', color: '#4b5563', cursor: 'not-allowed' as const };

const Card: React.FC<{ title: string; subtitle?: string; icon: React.ReactNode; children: React.ReactNode }> = ({ title, subtitle, icon, children }) => (
  <div className="rounded-2xl p-5" style={{ background: '#1e2235', border: '1px solid rgba(255,255,255,0.06)' }}>
    <div className="flex items-center gap-3 mb-5">
      <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.2)' }}>
        <span className="text-yellow-400">{icon}</span>
      </div>
      <div>
        <div className="text-sm font-semibold text-white">{title}</div>
        {subtitle && <div className="text-xs mt-0.5" style={{ color: '#6b7280' }}>{subtitle}</div>}
      </div>
    </div>
    {children}
  </div>
);

export const Settings: React.FC = () => {
  const { user, fetchMe } = useAuthStore();
  const { voice, autoCallInterval, setAutoCallInterval, setVoice } = useGameSettings();
  const [form, setForm] = useState({ firstName: user?.firstName ?? '', lastName: user?.lastName ?? '' });
  const [saved, setSaved] = useState(false);

  // Voice cache state
  const [cacheStatus, setCacheStatus] = useState<{ cached: number; total: number } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [dlProgress, setDlProgress] = useState({ cached: 0, total: 0 });
  const [dlDone, setDlDone] = useState(false);

  const voiceLabel = ALL_VOICE_CATEGORIES.find(v => v.value === voice)?.label ?? voice;

  const checkCache = useCallback(async () => {
    const status = await getVoiceCacheStatus(voice);
    setCacheStatus(status);
  }, [voice]);

  useEffect(() => { checkCache(); }, [checkCache]);

  const handleDownload = async () => {
    setDownloading(true);
    setDlDone(false);
    setDlProgress({ cached: 0, total: 0 });
    try {
      await downloadVoiceSounds(voice, (cached, total) => setDlProgress({ cached, total }));
      setDlDone(true);
      await checkCache();
      setTimeout(() => setDlDone(false), 3000);
    } finally {
      setDownloading(false);
    }
  };

  const updateMutation = useMutation({
    mutationFn: () => userApi.updateMe(form),
    onSuccess: () => { fetchMe(); setSaved(true); setTimeout(() => setSaved(false), 2500); },
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const paymentType = (user as any)?.paymentType ?? 'prepaid';
  const status = (user as any)?.status ?? 'active';

  return (
    <div className="h-full overflow-auto" style={{ background: '#0e1a35' }}>
      <div className="max-w-xl mx-auto px-4 py-6 space-y-4">

        {/* Header */}
        <div className="mb-2">
          <h1 className="text-xl font-bold text-white">Settings</h1>
          <p className="text-sm mt-0.5" style={{ color: '#6b7280' }}>Manage your profile and preferences</p>
        </div>

        {/* Account Info banner */}
        <div className="rounded-2xl px-5 py-4 flex items-center gap-4"
          style={{ background: 'linear-gradient(135deg,rgba(251,191,36,0.1),rgba(251,191,36,0.03))', border: '1px solid rgba(251,191,36,0.18)' }}>
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 font-bold text-gray-900 text-lg"
            style={{ background: 'linear-gradient(135deg,#fbbf24,#f59e0b)' }}>
            {(user?.username ?? 'U').slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-white truncate">{user?.username}</div>
            <div className="text-xs truncate mt-0.5" style={{ color: '#9ca3af' }}>{user?.email}</div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-xs mb-1" style={{ color: '#6b7280' }}>Balance</div>
            <div className="font-bold text-yellow-400">{Number(user?.balance ?? 0).toFixed(0)} Birr</div>
          </div>
        </div>

        {/* Offline ready banner removed — sounds auto-download on login */}

        {/* Profile */}
        <Card
          title="Profile"
          subtitle="Update your display name"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" strokeLinecap="round" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          }
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="First Name">
                <input name="firstName" value={form.firstName} onChange={handleChange}
                  className={inputCls} style={inputStyle} placeholder="First name" />
              </Field>
              <Field label="Last Name">
                <input name="lastName" value={form.lastName} onChange={handleChange}
                  className={inputCls} style={inputStyle} placeholder="Last name" />
              </Field>
            </div>
            <Field label="Username">
              <input value={user?.username ?? ''} disabled className={inputCls} style={disabledStyle} />
            </Field>
            <Field label="Email">
              <input value={user?.email ?? ''} disabled className={inputCls} style={disabledStyle} />
            </Field>
            <div className="flex items-center gap-3 pt-1">
              <button onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending}
                className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#fbbf24,#f59e0b)', color: '#111' }}>
                {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
              </button>
              {saved && (
                <span className="flex items-center gap-1.5 text-sm text-emerald-400">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-4 h-4">
                    <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Saved
                </span>
              )}
            </div>
          </div>
        </Card>

        {/* Game Settings */}
        <Card
          title="Game Settings"
          subtitle="Auto-call speed"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <polygon points="5,3 19,12 5,21" strokeLinejoin="round" />
            </svg>
          }
        >
          <div className="space-y-5">
            <div>
              <div className="flex justify-between items-center mb-2.5">
                <span className="text-xs font-medium" style={{ color: '#6b7280' }}>Auto Call Interval</span>
                <span className="text-sm font-bold text-yellow-400">{autoCallInterval}s</span>
              </div>
              <input type="range" min={2} max={15} value={autoCallInterval}
                onChange={(e) => setAutoCallInterval(Number(e.target.value))}
                className="w-full accent-yellow-400 h-1.5 rounded-full"
                style={{ background: `linear-gradient(to right,#fbbf24 ${((autoCallInterval - 2) / 13) * 100}%,rgba(255,255,255,0.1) 0%)` }} />
              <div className="flex justify-between text-xs mt-1.5" style={{ color: '#4b5563' }}>
                <span>2s (fast)</span><span>15s (slow)</span>
              </div>
            </div>
          </div>
        </Card>

        {/* Voice Sounds */}
        <Card
          title="Voice Sounds"
          subtitle="Select a voice and download for offline play"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <path d="M9 18V5l12-2v13" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
            </svg>
          }
        >
          <div className="space-y-4">
            {/* Voice selector grid */}
            <div className="grid grid-cols-2 gap-2">
              {ALL_VOICE_CATEGORIES.map((v) => {
                const isActive = voice === v.value;
                return (
                  <button
                    key={v.value}
                    onClick={() => setVoice(v.value)}
                    className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-left"
                    style={isActive
                      ? { background: 'rgba(251,191,36,0.15)', border: '1px solid rgba(251,191,36,0.4)', color: '#fbbf24' }
                      : { background: '#0e1a35', border: '1px solid rgba(255,255,255,0.06)', color: '#9ca3af' }
                    }
                  >
                    <span className="text-base leading-none">{v.label.split(' ')[0]}</span>
                    <span className="truncate">{v.label.split(' ').slice(1).join(' ')}</span>
                    {isActive && (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3.5 h-3.5 ml-auto shrink-0 text-yellow-400">
                        <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Active voice indicator */}
            <div className="flex items-center justify-between py-2.5 px-3 rounded-xl"
              style={{ background: '#0e1a35', border: '1px solid rgba(255,255,255,0.05)' }}>
              <span className="text-sm" style={{ color: '#9ca3af' }}>Active Voice</span>
              <span className="text-sm font-semibold text-yellow-400">{voiceLabel}</span>
            </div>

            {/* Cache status */}
            {cacheStatus && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs" style={{ color: '#6b7280' }}>
                  <span>Cached files</span>
                  <span className={cacheStatus.cached >= cacheStatus.total ? 'text-emerald-400 font-semibold' : 'text-yellow-400 font-semibold'}>
                    {cacheStatus.cached} / {cacheStatus.total}
                  </span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.07)' }}>
                  <div className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: cacheStatus.total > 0 ? `${Math.round((cacheStatus.cached / cacheStatus.total) * 100)}%` : '0%',
                      background: cacheStatus.cached >= cacheStatus.total
                        ? 'linear-gradient(90deg,#34d399,#10b981)'
                        : 'linear-gradient(90deg,#f59e0b,#fbbf24)',
                    }} />
                </div>
              </div>
            )}

            {/* Download progress bar */}
            {downloading && dlProgress.total > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs" style={{ color: '#6b7280' }}>
                  <span>Downloading…</span>
                  <span className="text-yellow-400 font-semibold">{dlProgress.cached} / {dlProgress.total}</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.07)' }}>
                  <div className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${Math.round((dlProgress.cached / dlProgress.total) * 100)}%`,
                      background: 'linear-gradient(90deg,#f59e0b,#fbbf24)',
                      boxShadow: '0 0 6px rgba(251,191,36,0.4)',
                    }} />
                </div>
              </div>
            )}

            {/* Button */}
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="w-full py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all disabled:opacity-60"
              style={dlDone
                ? { background: 'rgba(52,211,153,0.15)', border: '1px solid rgba(52,211,153,0.3)', color: '#34d399' }
                : { background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.25)', color: '#fbbf24' }}>
              {downloading ? (
                <>
                  <div className="w-4 h-4 rounded-full border-2 border-yellow-400/30 border-t-yellow-400 animate-spin" />
                  Downloading…
                </>
              ) : dlDone ? (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-4 h-4">
                    <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Up to date
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                    <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1M7 10l5 5 5-5M12 15V3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Update Audio
                </>
              )}
            </button>
          </div>
        </Card>

        {/* Account Info */}
        <Card
          title="Account Info"
          subtitle="Your account details"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4M12 16h.01" strokeLinecap="round" />
            </svg>
          }
        >
          <div className="space-y-3">
            {[
              { label: 'Payment Type', value: <span className="px-2.5 py-1 rounded-full text-xs font-semibold"
                  style={paymentType === 'prepaid' ? { background: 'rgba(139,92,246,0.15)', color: '#a78bfa' } : { background: 'rgba(251,146,60,0.15)', color: '#fb923c' }}>{paymentType}</span> },
              { label: 'Balance', value: <span className="font-bold text-yellow-400">{Number(user?.balance ?? 0).toFixed(0)} Birr</span> },
              { label: 'Status', value: <span className="px-2.5 py-1 rounded-full text-xs font-semibold"
                  style={status === 'active' ? { background: 'rgba(52,211,153,0.15)', color: '#34d399' } : { background: 'rgba(248,113,113,0.15)', color: '#f87171' }}>{status}</span> },
            ].map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between py-2.5 px-3 rounded-xl"
                style={{ background: '#0e1a35', border: '1px solid rgba(255,255,255,0.05)' }}>
                <span className="text-sm" style={{ color: '#9ca3af' }}>{label}</span>
                {value}
              </div>
            ))}
          </div>
        </Card>

      </div>
    </div>
  );
};
