import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { userApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { useGameSettings, VoiceCategory } from '../../store/gameSettingsStore';

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <label className="block text-xs font-medium mb-1.5" style={{ color: '#6b7280' }}>{label}</label>
    {children}
  </div>
);

const inputCls = 'w-full rounded-xl px-3.5 py-2.5 text-sm outline-none transition-all focus:ring-2 focus:ring-yellow-400/40';
const inputStyle = { background: '#0e1a35', border: '1px solid rgba(255,255,255,0.08)', color: '#e5e7eb' };
const disabledStyle = { background: '#0a1220', border: '1px solid rgba(255,255,255,0.05)', color: '#4b5563', cursor: 'not-allowed' };

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
  const { voice, autoCallInterval, setVoice, setAutoCallInterval } = useGameSettings();
  const [form, setForm] = useState({ firstName: user?.firstName ?? '', lastName: user?.lastName ?? '' });
  const [saved, setSaved] = useState(false);

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
            <div className="font-bold text-yellow-400">{Number(user?.balance ?? 0).toFixed(2)} Birr</div>
          </div>
        </div>

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
              <button
                onClick={() => updateMutation.mutate()}
                disabled={updateMutation.isPending}
                className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#fbbf24,#f59e0b)', color: '#111' }}
              >
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
          subtitle="Caller voice and auto-call speed"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <polygon points="5,3 19,12 5,21" strokeLinejoin="round" />
            </svg>
          }
        >
          <div className="space-y-5">
            {/* Voice */}
            <div>
              <div className="text-xs font-medium mb-2.5" style={{ color: '#6b7280' }}>Caller Voice</div>
              <div className="grid grid-cols-2 gap-2">
                {(['boy sound', 'girl sound'] as VoiceCategory[]).map((v) => (
                  <button
                    key={v}
                    onClick={() => setVoice(v)}
                    className="py-3 rounded-xl text-sm font-medium transition-all"
                    style={voice === v
                      ? { background: 'rgba(251,191,36,0.15)', border: '1.5px solid rgba(251,191,36,0.5)', color: '#fbbf24' }
                      : { background: '#0e1a35', border: '1px solid rgba(255,255,255,0.07)', color: '#6b7280' }
                    }
                  >
                    {v === 'boy sound' ? '👦 Boy' : '👧 Girl'}
                  </button>
                ))}
              </div>
            </div>

            {/* Auto-call interval */}
            <div>
              <div className="flex justify-between items-center mb-2.5">
                <span className="text-xs font-medium" style={{ color: '#6b7280' }}>Auto Call Interval</span>
                <span className="text-sm font-bold text-yellow-400">{autoCallInterval}s</span>
              </div>
              <input
                type="range" min={2} max={15} value={autoCallInterval}
                onChange={(e) => setAutoCallInterval(Number(e.target.value))}
                className="w-full accent-yellow-400 h-1.5 rounded-full"
                style={{ background: `linear-gradient(to right,#fbbf24 ${((autoCallInterval - 2) / 13) * 100}%,rgba(255,255,255,0.1) 0%)` }}
              />
              <div className="flex justify-between text-xs mt-1.5" style={{ color: '#4b5563' }}>
                <span>2s (fast)</span><span>15s (slow)</span>
              </div>
            </div>

            {/* Preview */}
            <button
              onClick={() => {
                const n = Math.floor(Math.random() * 75) + 1;
                new Audio(`/sounds/${encodeURIComponent(voice)}/${n}.wav`).play().catch(() => {});
              }}
              className="w-full py-2.5 rounded-xl text-sm font-medium transition-all"
              style={{ background: '#0e1a35', border: '1px solid rgba(255,255,255,0.07)', color: '#9ca3af' }}
            >
              🔊 Preview Voice
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
              {
                label: 'Payment Type',
                value: (
                  <span className="px-2.5 py-1 rounded-full text-xs font-semibold"
                    style={paymentType === 'prepaid'
                      ? { background: 'rgba(139,92,246,0.15)', color: '#a78bfa' }
                      : { background: 'rgba(251,146,60,0.15)', color: '#fb923c' }}>
                    {paymentType}
                  </span>
                ),
              },
              {
                label: 'Balance',
                value: <span className="font-bold text-yellow-400">{Number(user?.balance ?? 0).toFixed(2)} Birr</span>,
              },
              {
                label: 'Status',
                value: (
                  <span className="px-2.5 py-1 rounded-full text-xs font-semibold"
                    style={status === 'active'
                      ? { background: 'rgba(52,211,153,0.15)', color: '#34d399' }
                      : { background: 'rgba(248,113,113,0.15)', color: '#f87171' }}>
                    {status}
                  </span>
                ),
              },
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
