# Prepaid User Analysis & Recommendations

## Current Implementation

### What Are Prepaid Users?
Prepaid users (default) must have sufficient balance upfront before playing. They cannot go into debt. Unlike postpaid users, prepaid players get full offline-first PWA support with sound caching.

**Key Characteristics:**
| Feature | Implementation |
|---------|-----------------|
| Balance Model | Cash-based (must have funds upfront) |
| Negative Balance | Blocked from playing |
| Offline Gameplay | Full support (offline-first) |
| Audio Caching | Pre-cached to IndexedDB |
| PWA Initialization | Required (shows cache progress) |
| Balance Recovery | Admin top-up + polling |

---

## Code Flow Analysis

### Backend Validation (GameService.ts:65-74)

```typescript
if (user.paymentType !== 'postpaid') {
  // PREPAID USER PATH
  if (Number(user.balance) < houseCut)
    throw new AppError(400, 'INSUFFICIENT_BALANCE', 'Insufficient balance');
}
```

**✓ Correct:** Prepaid users must have exact balance.

### Frontend Offline-First Strategy (offlineApi.ts:281-326)

```typescript
// Prepaid users → ALWAYS use offline mode (instant response, no network wait)
const totalBet = data.betAmountPerCartela * data.cartelaIds.length;
const houseCut = totalBet * (HOUSE_PCT / 100);

// Block prepaid users from creating games when balance is insufficient
if (useAuthStore.getState().negativeBalance || isNegativeBalanceLocked()) {
  throw Object.assign(new Error('Account locked: negative balance'), { code: 'NEGATIVE_BALANCE' });
}
const currentBalance = Number(user?.balance ?? 0);
if (currentBalance <= 0 || currentBalance < houseCut) {
  throw Object.assign(new Error('Insufficient balance'), { code: 'INSUFFICIENT_BALANCE' });
}

// Create offline game immediately
const game = { id: tempId, /* ... */ };
await dbPut('games', game);
await applyBalanceDelta(-houseCut);  // Deduct house cut immediately

// Queue for sync
await enqueue({ type: 'createGame', payload: { tempId, ...data } });
return { data: { data: game } };
```

**✓ Excellent:** Instant response, offline-capable.

### Negative Balance Handling (authStore.ts:186-210)

```typescript
if (user.paymentType === 'prepaid' && user.role !== 'admin') {
  // Skip download screen if already cached for this user
  const cacheKey = `sw_cached_${user.id}`;
  const alreadyCached = localStorage.getItem(cacheKey) === '1';

  if (alreadyCached) {
    set({ user, loading: false, initialized: true });
  } else {
    // Show download screen — NOT initialized yet
    set({ user, loading: false, initialized: false });
    // Fetch & cache all data...
  }
}
```

**✓ Good:** Prepaid users required to complete PWA init.

### Balance Refund on Sync Failure (sync.ts:180-215)

```typescript
if (postErr?.response?.status && p.tempId) {
  // Server rejected game permanently (e.g. INSUFFICIENT_BALANCE)
  // Restore the house-cut that was deducted locally
  const houseCut = (p.betAmountPerCartela ?? 0) * (p.cartelaIds?.length ?? 0)
    * ((p.housePercentage ?? 10) / 100);
  if (houseCut > 0) {
    await adjustBalance(houseCut);  // Refund deducted amount
    useAuthStore.getState().adjustUserBalance(houseCut);
  }
}
```

**✓ Excellent:** Safety mechanism to prevent lost funds.

### Negative Balance Recovery (sync.ts:350-380)

```typescript
function startRecoveryPolling() {
  if (_recoveryInterval) return;
  _recoveryInterval = setInterval(async () => {
    if (!navigator.onLine) return;
    try {
      const res = await api.get('/users/me');
      const fresh = res.data?.data;
      if (!fresh) return;
      const balance = Number(fresh.balance ?? 0);
      if (balance >= 0) {
        // Admin resolved it — unblock and do a full sync
        clearInterval(_recoveryInterval!);
        _recoveryInterval = null;
        useAuthStore.getState().adjustUserBalance(balance - (Number(...)));
        applyNegativeBalanceCheck(...);
        await refreshCache();
        window.dispatchEvent(new CustomEvent('balance-restored'));
      }
    } catch {}
  }, 15_000);  // Poll every 15 seconds
}
```

**✓ Good:** Auto-recovery when admin tops up.

---

## Identified Issues

### 🟡 **Issue #1: Prepaid Balance Check is Imprecise**
**Severity:** MEDIUM  
**Location:** `offlineApi.ts:287-289`

```typescript
const currentBalance = Number(user?.balance ?? 0);
if (currentBalance <= 0 || currentBalance < houseCut) {
  throw ...
}
```

**Problems:**
1. Checks `<= 0` (should be `< 0` only; `0` is technically valid but will fail)
2. Doesn't check for floating-point precision issues
3. Race condition: balance might change between read and deduct

**Example Bug:**
```
Balance: 0.00
House cut: 0.50
Check: 0 <= 0 → BLOCKED ✓ (correct by accident)

Balance: 0.01
House cut: 0.05
Check: 0.01 < 0.05 → BLOCKED ✓ (correct)

Balance: 0.01
House cut: 0.01
Check: 0.01 < 0.01 → FALSE (off by floating point rounding)
Deduct: 0.01 → Balance = 0.00
Sync: Server says 0.01 (race condition)
```

---

### 🟡 **Issue #2: PWA Initialization is Mandatory But Can Fail Silently**
**Severity:** MEDIUM  
**Location:** `authStore.ts:195-220`

Current flow:
1. Prepaid user logs in
2. `initialized = false` (blocking UI)
3. Fetch user data, cartelas, games, transactions in parallel
4. If ANY fetch fails, no error is thrown — just shows "Loading…"
5. No retry mechanism or manual reload button

**User Experience:**
- User gets stuck on "Caching…" screen
- No indication of what failed
- No "Retry" button
- Must manually refresh page

**Code:**
```typescript
const mark = (i: number, status: CacheStep['status'], count?: number) => {
  steps[i] = { ...steps[i], status, ...(count !== undefined ? { count } : {}) };
  set({ cacheSteps: [...steps] });
};

const fetches: Array<...> = [
  { url: '/users/me',              store: 'user',         key: 'me', index: 0 },
  { url: '/cartelas/mine',         store: 'cartelas',                index: 1 },
  { url: '/games/mine',            store: 'games',                   index: 2 },
  { url: '/users/me/transactions', store: 'transactions',            index: 3 },
];

fetches.forEach(f => mark(f.index, 'loading'));

await Promise.all(fetches.map(async (f) => {
  try {
    const r = await api.get(f.url);
    const data = r.data.data;
    // ... store in IDB ...
    mark(f.index, 'done', 1);
  } catch (err) {
    // ERROR IS SILENTLY SWALLOWED
    mark(f.index, 'error');  // ← Probably set, but no UI to show it
  }
}));
```

---

### 🟡 **Issue #3: No Max Bet Limit for Prepaid Users**
**Severity:** MEDIUM  
**Location:** `GameService.ts` (missing validation)

Current validation only checks:
- `balance >= houseCut`

Missing validations:
- Max bet per game (could be $1M if player has that balance)
- Max concurrent bets (player could create 100 games simultaneously)
- Daily/weekly spend caps (no limits on total gambling volume)

**Risk:** A prepaid player with large balance could:
- Create a $10M game and crash the prize pool calculation
- Create 1000 concurrent games, breaking server
- Trigger decimal overflow in prize pool calculations

---

### 🟡 **Issue #4: Race Condition in Offline Balance Deduction**
**Severity:** MEDIUM  
**Location:** `offlineApi.ts:303-315`

```typescript
const currentBalance = Number(user?.balance ?? 0);
if (currentBalance < houseCut) throw error;

const game = { /* ... */ };
await dbPut('games', game);
await applyBalanceDelta(-houseCut);  // Gap here!

// Another tab/window could have created a game between the check and deduct
```

**Scenario:**
1. Tab A checks: balance = $100, houseCut = $50 ✓
2. Tab B checks: balance = $100, houseCut = $60 ✓
3. Tab A deducts: $100 - $50 = $50
4. Tab B deducts: $50 - $60 = -$10 ← NEGATIVE!

**Fix:** Must be atomic read-check-deduct operation.

---

### 🟡 **Issue #5: Sound Caching May Consume Excessive Storage**
**Severity:** LOW  
**Location:** `authStore.ts:220-250`

Prepaid users download ALL voice categories (~500MB+ of audio):
- boy sound
- girl sound  
- boy with symbol
- etc.

**Problems:**
- No storage quota check before caching
- No cache purge mechanism
- No selective download options
- Slow on 3G networks (could take 5+ minutes)

**User Impact:**
- Phone storage fills up
- PWA becomes bloated
- Slow initialization on poor networks

---

### 🟡 **Issue #6: No Reconciliation on Offline Balance Mismatch**
**Severity:** MEDIUM  
**Location:** `sync.ts:30-50` (missing logic)

Current behavior:
```typescript
const isLocked = localStorage.getItem('neg_balance_locked') === '1';
if (isLocked || (pendingQueue.length > 0 && localUser)) {
  if (localUser) meData.balance = localUser.balance;  // Use LOCAL balance
  console.log(`[balance] refreshCache server=${meData?.balance} locked=${isLocked} pending=${pendingQueue.length}`);
}
```

**Issue:** If server balance > local balance:
- Local: $50 (after offline bet)
- Server: $80 (never received offline bet)
- System: Uses local $50
- Result: $30 stuck on server forever

**Example:**
1. Offline: Create game ($50 bet deducted locally) → balance = $50
2. Go online
3. Sync fails (network error)
4. Server still has $80 (never received bet)
5. Local has $50
6. System: Assumes balance is $50, never reconciles $30

---

### 🟡 **Issue #7: Floating Point Precision in Prize Pool**
**Severity:** LOW  
**Location:** `GameService.ts:94-95`

```typescript
prizePool: totalCost - houseCut
```

With decimal arithmetic:
- Total: $100.50
- House: $10.05
- Prize: $90.45 (might be $90.44999999 due to floating point)

**Problems:**
- Prize pool might be off by 1 cent
- Over thousands of games, could lose/gain significant amounts
- No rounding specification

**Better:**
```typescript
prizePool: Number((totalCost - houseCut).toFixed(2))
```

---

### 🟡 **Issue #8: No Spending Limits UI**
**Severity:** LOW  
**Location:** Missing entirely

Prepaid users have no way to:
- Set daily/weekly/monthly limits
- See total gambling spend
- Get warnings when approaching limits
- Self-exclude or cool-off

**Compliance Issue:** Many jurisdictions require responsible gambling tools.

---

## Recommended Fixes

### ✅ **Recommendation #1: Fix Balance Check Logic**
**Priority:** HIGH  
**Effort:** 15 min

**offlineApi.ts**

```typescript
// CURRENT (BUGGY)
const currentBalance = Number(user?.balance ?? 0);
if (currentBalance <= 0 || currentBalance < houseCut) {
  throw Object.assign(new Error('Insufficient balance'), { code: 'INSUFFICIENT_BALANCE' });
}

// RECOMMENDED
const currentBalance = Number(user?.balance ?? 0);
// Check: must have enough for the bet (allow exactly 0 before bet)
if (currentBalance < 0) {
  throw Object.assign(new Error('Negative balance'), { code: 'NEGATIVE_BALANCE' });
}
if (!Number.isFinite(currentBalance) || currentBalance < houseCut) {
  throw Object.assign(new Error('Insufficient balance'), { code: 'INSUFFICIENT_BALANCE' });
}

// Use precise decimal arithmetic
const preciseBet = Number((houseCut).toFixed(2));
if (currentBalance < preciseBet) {
  throw Object.assign(new Error('Insufficient balance'), { code: 'INSUFFICIENT_BALANCE' });
}
```

---

### ✅ **Recommendation #2: Add PWA Initialization Error Handling**
**Priority:** HIGH  
**Effort:** 1-2 hrs

**authStore.ts**

```typescript
interface CacheStep {
  label: string;
  status: 'pending' | 'loading' | 'done' | 'skipped' | 'error';  // Add 'error'
  count?: number;
  total?: number;
  cached?: number;
  error?: string;  // Add error message
  retryable?: boolean;
}

async function fetchMe() {
  const fetches: Array<...> = [
    { url: '/users/me',              store: 'user',         key: 'me', index: 0 },
    { url: '/cartelas/mine',         store: 'cartelas',                index: 1 },
    { url: '/games/mine',            store: 'games',                   index: 2 },
    { url: '/users/me/transactions', store: 'transactions',            index: 3 },
  ];

  fetches.forEach(f => mark(f.index, 'loading'));

  const results = await Promise.allSettled(fetches.map(async (f) => {
    try {
      const r = await api.get(f.url);
      return { success: true, f, data: r.data.data };
    } catch (err: any) {
      return { 
        success: false, 
        f, 
        error: err?.response?.status === 401 
          ? 'Session expired'
          : err?.message ?? 'Network error',
        retryable: !err?.response?.status,
      };
    }
  }));

  const errors = results
    .map((r, i) => r.status === 'rejected' ? fetches[i] : r.value?.success === false ? r.value : null)
    .filter(Boolean);

  if (errors.length > 0) {
    // Mark failed steps
    errors.forEach(err => {
      mark(err.f?.index, 'error', 0);
    });

    set({ 
      cacheInitError: `Failed to load ${errors.map(e => e.f?.store).join(', ')}. Retry?`,
      cacheSteps: [...steps],
    });

    throw new Error(`Cache initialization failed: ${errors[0].f?.url}`);
  }

  // ... continue with successful loads ...
}
```

**UI Component:**
```typescript
{cacheInitError && (
  <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4">
    <div className="bg-gray-800 rounded-lg p-6 max-w-sm text-center space-y-4">
      <div className="text-red-400 font-semibold">{cacheInitError}</div>
      <div className="space-y-2">
        <button 
          onClick={() => window.location.reload()}
          className="w-full px-4 py-2 bg-yellow-500 text-black rounded-lg font-semibold"
        >
          Retry
        </button>
        <button 
          onClick={() => { localStorage.clear(); window.location.href = '/login'; }}
          className="w-full px-4 py-2 bg-gray-600 text-white rounded-lg"
        >
          Clear Cache & Login
        </button>
      </div>
      <div className="text-xs text-gray-400">
        {cacheSteps.map(s => (
          <div key={s.label}>
            {s.label}: {s.status === 'error' ? `❌ ${s.error}` : `${s.status}`}
          </div>
        ))}
      </div>
    </div>
  </div>
)}
```

---

### ✅ **Recommendation #3: Add Max Bet Limits**
**Priority:** MEDIUM  
**Effort:** 1 hr

**env.ts (Backend)**

```typescript
export const env = {
  // ... existing ...
  MAX_BET_PER_GAME: parseFloat(process.env.MAX_BET_PER_GAME || '1000'),
  MAX_CONCURRENT_GAMES: parseInt(process.env.MAX_CONCURRENT_GAMES || '10'),
  MAX_DAILY_SPEND: parseFloat(process.env.MAX_DAILY_SPEND || '5000'),
};
```

**GameService.ts**

```typescript
async createGame(userId: string, dto: CreateGameDTO): Promise<Game> {
  // ... existing validation ...

  const totalCost = dto.betAmountPerCartela * dto.cartelaIds.length;

  // Check max bet per game
  if (dto.betAmountPerCartela > env.MAX_BET_PER_GAME) {
    throw new AppError(400, 'BET_EXCEEDS_LIMIT', 
      `Max bet per cartela: $${env.MAX_BET_PER_GAME}`);
  }

  // Check max concurrent games
  const activeGameCount = await this.gameRepo.count({
    where: { creatorId: userId, status: 'active' },
  });
  if (activeGameCount >= env.MAX_CONCURRENT_GAMES) {
    throw new AppError(400, 'TOO_MANY_GAMES', 
      `Max ${env.MAX_CONCURRENT_GAMES} concurrent games`);
  }

  // Check daily spend
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todaysTx = await AppDataSource.getRepository(Transaction)
    .createQueryBuilder('t')
    .where('t.userId = :userId', { userId })
    .andWhere('t.createdAt >= :since', { since: today })
    .andWhere('t.type = :type', { type: 'bet' })
    .select('SUM(t.amount)', 'total')
    .getRawOne();

  const dailySpent = Number(todaysTx?.total ?? 0);
  if (dailySpent + totalCost > env.MAX_DAILY_SPEND) {
    throw new AppError(400, 'DAILY_LIMIT_EXCEEDED', 
      `Daily limit: $${env.MAX_DAILY_SPEND}. Today: $${dailySpent.toFixed(2)}`);
  }

  // ... continue ...
}
```

---

### ✅ **Recommendation #4: Make Balance Deduction Atomic**
**Priority:** HIGH  
**Effort:** 2 hrs

Use IndexedDB transactions:

**db.ts**

```typescript
/**
 * Atomic read-check-deduct operation.
 * Returns { success: true, newBalance } or { success: false, reason }
 */
export async function atomicDeductBalance(amount: number): Promise<{ success: boolean; newBalance?: number; reason?: string }> {
  return new Promise((resolve, reject) => {
    const db = (window as any).__idb_instance;
    if (!db) return resolve({ success: false, reason: 'DB not initialized' });

    const tx = db.transaction(['user'], 'readwrite');
    const store = tx.objectStore('user');
    const getReq = store.get('me');

    getReq.onsuccess = () => {
      const user = getReq.result;
      const currentBalance = Number(user?.balance ?? 0);

      if (currentBalance < amount) {
        resolve({ success: false, reason: 'INSUFFICIENT_BALANCE' });
        tx.abort();
        return;
      }

      const newBalance = currentBalance - amount;
      const putReq = store.put({ ...user, balance: newBalance }, 'me');

      putReq.onsuccess = () => {
        resolve({ success: true, newBalance });
      };
      putReq.onerror = () => {
        resolve({ success: false, reason: 'WRITE_FAILED' });
      };
    };

    getReq.onerror = () => {
      resolve({ success: false, reason: 'READ_FAILED' });
    };

    tx.onerror = () => {
      resolve({ success: false, reason: 'TX_FAILED' });
    };
  });
}
```

**offlineApi.ts**

```typescript
create: async (data) => {
  // ... existing validation ...

  // Atomic deduction
  const deductResult = await atomicDeductBalance(houseCut);
  if (!deductResult.success) {
    throw Object.assign(new Error(deductResult.reason), { code: 'INSUFFICIENT_BALANCE' });
  }

  // If we got here, balance was deducted atomically
  const game = { /* ... */ };
  await dbPut('games', game);
  useAuthStore.getState().adjustUserBalance(deductResult.newBalance!);
  // ... rest of code ...
}
```

---

### ✅ **Recommendation #5: Use Precise Decimal Arithmetic**
**Priority:** MEDIUM  
**Effort:** 1 hr

Create a decimal utility:

**utils/decimal.ts**

```typescript
export function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

export function deductCurrency(total: number, amount: number): number {
  return roundCurrency(total - amount);
}

export function addCurrency(total: number, amount: number): number {
  return roundCurrency(total + amount);
}

export function calculateHouseCut(betAmount: number, percentage: number): number {
  return roundCurrency(betAmount * (percentage / 100));
}
```

**GameService.ts**

```typescript
import { roundCurrency, calculateHouseCut } from '../../shared/utils/decimal';

const totalCost = betAmount * cartelaIds.length;
const houseCut = calculateHouseCut(totalCost, HOUSE_PCT);
const prizePool = roundCurrency(totalCost - houseCut);
```

---

### ✅ **Recommendation #6: Add Balance Reconciliation**
**Priority:** HIGH  
**Effort:** 2-3 hrs

**sync.ts**

```typescript
export async function reconcileBalance(): Promise<void> {
  try {
    const localUser = await dbGet<any>('user', 'me');
    const res = await api.get('/users/me');
    const serverUser = res.data?.data;

    if (!localUser || !serverUser) return;

    const localBalance = Number(localUser.balance ?? 0);
    const serverBalance = Number(serverUser.balance ?? 0);
    const diff = serverBalance - localBalance;

    if (Math.abs(diff) > 0.01) {  // Allow 1 cent difference
      logger.warn('Balance mismatch after sync', {
        local: localBalance,
        server: serverBalance,
        diff,
      });

      // Create audit record
      await AppDataSource.getRepository(AuditLog).save({
        userId: localUser.id,
        action: 'BALANCE_RECONCILIATION',
        details: {
          localBalance,
          serverBalance,
          difference: diff,
          resolved: true,
        },
        timestamp: new Date(),
      });

      // Use server as source of truth
      await dbPut('user', { ...localUser, balance: serverBalance }, 'me');
      useAuthStore.getState().adjustUserBalance(diff);
      
      return;
    }
  } catch (err) {
    logger.error('Balance reconciliation failed', err);
  }
}
```

---

### ✅ **Recommendation #7: Add Responsible Gambling Controls**
**Priority:** MEDIUM  
**Effort:** 3-4 hrs

**New User Fields (User.ts)**

```typescript
@Column({ name: 'daily_limit', type: 'decimal', precision: 12, scale: 2, nullable: true })
dailyLimit?: number;

@Column({ name: 'weekly_limit', type: 'decimal', precision: 12, scale: 2, nullable: true })
weeklyLimit?: number;

@Column({ name: 'monthly_limit', type: 'decimal', precision: 12, scale: 2, nullable: true })
monthlyLimit?: number;

@Column({ name: 'cooloff_until', type: 'timestamp', nullable: true })
cooloffUntil?: Date;
```

**New Endpoints**

```typescript
// Set limits
PATCH /api/users/me/limits
  body: { dailyLimit?: number, weeklyLimit?: number, monthlyLimit?: number }

// Get spending
GET /api/users/me/spending?period=day|week|month

// Cool off
POST /api/users/me/cooloff
  body: { days: number }
```

---

### ✅ **Recommendation #8: Optimize Audio Caching**
**Priority:** LOW  
**Effort:** 2 hrs

**authStore.ts**

```typescript
// Option 1: Selective caching
const cacheKey = `sw_cache_${user.id}`;
const cachedVoices = JSON.parse(localStorage.getItem(`${cacheKey}_voices`) || '[]');

// Only cache the default voice, skip others
const voiceToCache = (await import('../store/gameSettingsStore')).useGameSettings.getState().voice;
if (!cachedVoices.includes(voiceToCache)) {
  // Fetch only this voice's sounds
  await downloadVoiceSounds(voiceToCache);
  cachedVoices.push(voiceToCache);
  localStorage.setItem(`${cacheKey}_voices`, JSON.stringify(cachedVoices));
}

// Option 2: Lazy loading
// Don't cache all sounds at init. Cache only when needed (lazy).
// Show progress during gameplay if cache misses happen.
```

---

## Testing Recommendations

### Unit Tests
```typescript
test('Prepaid user cannot create game with insufficient balance', async () => {
  const user = { paymentType: 'prepaid', balance: 10 };
  expect(() => gameService.createGame(user.id, { cartelaIds, betAmountPerCartela: 20 }))
    .toThrow('INSUFFICIENT_BALANCE');
});

test('Balance deduction is atomic (no race conditions)', async () => {
  // Simulate concurrent deductions
  const p1 = atomicDeductBalance(50);
  const p2 = atomicDeductBalance(60);
  const results = await Promise.all([p1, p2]);
  
  // One should succeed, one should fail
  expect(results.filter(r => r.success).length).toBe(1);
  expect(results.filter(r => !r.success).length).toBe(1);
});

test('Prize pool calculation uses precise decimal arithmetic', async () => {
  const total = 100.50;
  const house = 10.05;
  const prize = roundCurrency(total - house);
  expect(prize).toBe(90.45);  // Not 90.44999...
});
```

### Integration Tests
- Offline game creation → sync → balance refund (on failure)
- PWA initialization with various network conditions
- Negative balance lock → admin top-up → recovery polling
- Concurrent games across multiple tabs

---

## Summary Table

| Issue | Severity | Fix | Effort |
|-------|----------|-----|--------|
| Imprecise balance check | 🟡 MEDIUM | Use `< 0`, not `<= 0` | 15 min |
| PWA init errors silent | 🟡 MEDIUM | Add error states + retry UI | 1-2 hrs |
| No max bet limits | 🟡 MEDIUM | Add env config + validation | 1 hr |
| Race condition in deduction | 🔴 HIGH | Atomic IDB transaction | 2 hrs |
| Floating point precision | 🟡 MEDIUM | Decimal utility | 1 hr |
| No balance reconciliation | 🟡 MEDIUM | Reconcile on sync | 2-3 hrs |
| Missing RG tools | 🟡 MEDIUM | Add limits + cooloff UI | 3-4 hrs |
| Audio cache bloat | 🟡 MEDIUM | Selective/lazy caching | 2 hrs |

---

## Configuration Checklist

```bash
# Add to .env
MAX_BET_PER_GAME=1000              # Max per cartela
MAX_CONCURRENT_GAMES=10            # Games per user
MAX_DAILY_SPEND=5000               # Daily limit
PWA_CACHE_TIMEOUT=30000            # ms before timeout
USE_DECIMAL_ARITHMETIC=true        # Enable precise currency
ENABLE_RECOVERY_POLLING=true       # Auto-recover from negative
```

---

## Key Differences: Prepaid vs Postpaid

| Aspect | Prepaid | Postpaid |
|--------|---------|----------|
| **Balance Check** | Must have funds upfront | Can go into debt (up to limit) |
| **Offline Support** | FULL (offline-first) | LIMITED (server-required) |
| **Audio Caching** | Pre-cached mandatory | Streamed on-demand |
| **Sync Strategy** | Instant local, async sync | Real-time server sync |
| **Balance Refund** | On sync failure | N/A (always server) |
| **Negative Balance** | BLOCKED completely | Admin can top-up |
| **Admin Control** | Limited (balance top-up only) | Full (limit/suspend) |
| **Recovery Polling** | Auto-polling on lockout | N/A |

