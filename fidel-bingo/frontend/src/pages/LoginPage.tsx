import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { login, loading, cacheSteps } = useAuthStore();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [caching, setCaching] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await login(identifier, password);
      // login() sets cacheSteps if prepaid — wait for them to finish before navigating
    } catch {
      setError('Invalid email/username or password');
    }
  };

  // Show cache overlay as soon as steps appear
  useEffect(() => {
    if (cacheSteps.length > 0) setCaching(true);
  }, [cacheSteps.length]);

  // Navigate once all steps are done/skipped
  useEffect(() => {
    if (!caching) return;
    const allDone = cacheSteps.length > 0 && cacheSteps.every(s => s.status === 'done' || s.status === 'skipped');
    if (allDone) {
      const t = setTimeout(() => navigate('/dashboard'), 600);
      return () => clearTimeout(t);
    }
  }, [cacheSteps, caching, navigate]);

  // For non-prepaid users cacheSteps stays empty — navigate right after login
  useEffect(() => {
    if (!loading && !caching && useAuthStore.getState().user) {
      navigate('/dashboard');
    }
  }, [loading, caching, navigate]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-600 to-purple-700 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md relative overflow-hidden">

        <div className="flex flex-col items-center mb-6">
          <img src="/icons/logo.png" alt="Fidel Bingo" className="w-20 h-20 object-contain mb-3" />
          <h1 className="text-2xl font-bold text-blue-600">Fidel Bingo</h1>
          <p className="text-gray-500 text-sm mt-1">Sign in to play</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="identifier" className="block text-sm font-medium text-gray-700 mb-1">Email or Username</label>
            <input
              id="identifier"
              type="text"
              required
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              className="w-full border rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="you@example.com or username"
              autoComplete="username"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border rounded-lg px-4 py-2 pr-10 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-3 flex items-center text-gray-400 hover:text-gray-600"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {error && <div role="alert" className="text-red-600 text-sm text-center">{error}</div>}

          <button
            type="submit"
            disabled={loading || caching}
            className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p className="text-center text-xs text-gray-400 mt-4">
          Need help? Call <a href="tel:0934942672" className="text-blue-500 font-semibold">0934942672</a>
        </p>

        {/* ── Cache progress overlay ── */}
        {caching && (
          <div className="absolute inset-0 bg-white/95 flex flex-col items-center justify-center gap-4 rounded-2xl px-8">
            <div className="text-blue-600 font-bold text-lg mb-1">Preparing offline data...</div>
            <div className="w-full space-y-3">
              {cacheSteps.map((step, i) => (
                <div key={i} className="flex items-center gap-3">
                  {/* Icon */}
                  <div className="w-6 h-6 flex items-center justify-center shrink-0">
                    {step.status === 'done'    && <span className="text-green-500 text-lg">✓</span>}
                    {step.status === 'skipped' && <span className="text-gray-400 text-lg">—</span>}
                    {step.status === 'loading' && <Spinner />}
                    {step.status === 'pending' && <span className="w-4 h-4 rounded-full border-2 border-gray-200 inline-block" />}
                  </div>

                  {/* Label + bar */}
                  <div className="flex-1">
                    <div className="flex justify-between text-sm mb-1">
                      <span className={step.status === 'loading' ? 'text-blue-600 font-medium' : 'text-gray-600'}>
                        {step.label}
                      </span>
                      <span className="text-xs text-gray-400 capitalize">{step.status}</span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          step.status === 'done'    ? 'w-full bg-green-500' :
                          step.status === 'loading' ? 'w-2/3 bg-blue-500 animate-pulse' :
                          step.status === 'skipped' ? 'w-full bg-gray-300' : 'w-0'
                        }`}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const Spinner = () => (
  <svg className="animate-spin h-4 w-4 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
  </svg>
);
