import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { userApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { useGameSettings, VoiceCategory } from '../../store/gameSettingsStore';

export const Settings: React.FC = () => {
  const { user, fetchMe } = useAuthStore();
  const { voice, autoCallInterval, setVoice, setAutoCallInterval } = useGameSettings();
  const [form, setForm] = useState({
    firstName: user?.firstName ?? '',
    lastName: user?.lastName ?? '',
  });
  const [saved, setSaved] = useState(false);

  const updateMutation = useMutation({
    mutationFn: () => userApi.updateMe(form),
    onSuccess: () => {
      fetchMe();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  return (
    <div className="p-6 max-w-lg mx-auto">
      <h1 className="text-xl font-semibold mb-6">Settings</h1>

      <div className="bg-white rounded-xl shadow p-6 mb-4">
        <h2 className="font-medium text-gray-700 mb-4">Profile</h2>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">First Name</label>
              <input name="firstName" value={form.firstName} onChange={handleChange}
                className="border rounded-lg px-3 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Last Name</label>
              <input name="lastName" value={form.lastName} onChange={handleChange}
                className="border rounded-lg px-3 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Username</label>
            <input value={user?.username ?? ''} disabled
              className="border rounded-lg px-3 py-2 w-full text-sm bg-gray-50 text-gray-400 cursor-not-allowed" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Email</label>
            <input value={user?.email ?? ''} disabled
              className="border rounded-lg px-3 py-2 w-full text-sm bg-gray-50 text-gray-400 cursor-not-allowed" />
          </div>
        </div>
        <div className="mt-5 flex items-center gap-3">
          <button
            onClick={() => updateMutation.mutate()}
            disabled={updateMutation.isPending}
            className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
            {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
          </button>
          {saved && <span className="text-sm text-green-600">Saved!</span>}
        </div>
      </div>

      {/* ── Game Settings ── */}
      <div className="bg-white rounded-xl shadow p-6 mb-4">
        <h2 className="font-medium text-gray-700 mb-4">Game Settings</h2>
        <div className="space-y-5">

          {/* Voice category */}
          <div>
            <label className="block text-xs text-gray-500 mb-2">Caller Voice</label>
            <div className="flex gap-3">
              {(['boy sound', 'girl sound'] as VoiceCategory[]).map((v) => (
                <button
                  key={v}
                  onClick={() => setVoice(v)}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-medium border-2 transition-colors ${
                    voice === v
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {v === 'boy sound' ? '👦 Boy' : '👧 Girl'}
                </button>
              ))}
            </div>
          </div>

          {/* Auto-call interval */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-xs text-gray-500">Auto Call Interval</label>
              <span className="text-sm font-semibold text-gray-700">{autoCallInterval}s</span>
            </div>
            <input
              type="range"
              min={2}
              max={15}
              value={autoCallInterval}
              onChange={(e) => setAutoCallInterval(Number(e.target.value))}
              className="w-full accent-blue-500"
            />
            <div className="flex justify-between text-xs text-gray-400 mt-1">
              <span>2s (fast)</span>
              <span>15s (slow)</span>
            </div>
          </div>

          {/* Preview sound */}
          <button
            onClick={() => {
              const n = Math.floor(Math.random() * 75) + 1;
              const audio = new Audio(`/sounds/${encodeURIComponent(voice)}/${n}.wav`);
              audio.play().catch(() => {});
            }}
            className="w-full py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
          >
            🔊 Preview Voice
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow p-6">
        <h2 className="font-medium text-gray-700 mb-3">Account Info</h2>
        <div className="space-y-2 text-sm text-gray-600">
          <div className="flex justify-between">
            <span>Payment type</span>
            <span className={`px-2 py-0.5 rounded-full text-xs ${
              (user as any)?.paymentType === 'prepaid' ? 'bg-purple-100 text-purple-700' : 'bg-orange-100 text-orange-700'
            }`}>{(user as any)?.paymentType ?? '—'}</span>
          </div>
          <div className="flex justify-between">
            <span>Balance</span>
            <span className="font-semibold text-green-600">${Number(user?.balance ?? 0).toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>Status</span>
            <span className={`px-2 py-0.5 rounded-full text-xs ${
              (user as any)?.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
            }`}>{(user as any)?.status ?? '—'}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
