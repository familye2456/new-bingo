# Postpaid User Analysis & Recommendations

## Current Implementation

### What Are Postpaid Users?
Postpaid users are credit-based accounts where players can go into debt up to a `creditLimit`. Unlike prepaid users who must have sufficient balance before playing, postpaid users can play and settle later.

**Key Differences:**
| Feature | Prepaid | Postpaid |
|---------|---------|----------|
| Balance Model | Must have funds upfront | Credit-based (can go negative) |
| Credit Limit | N/A | Configurable (0 = unlimited) |
| Negative Balance | Blocked from playing | Allowed (settles later) |
| Audio Caching | Pre-cached to IndexedDB | Streamed on-demand |
| Offline Gameplay | Fully supported | Limited (server-dependent) |

---

## Code Analysis

### Backend (GameService.ts)

#### Game Creation Check
```typescript
if (user.paymentType !== 'postpaid') {
  if (Number(user.balance) < houseCut)
    throw new AppError(400, 'INSUFFICIENT_BALANCE', 'Insufficient balance');
} else {
  const creditLimit = Number(user.creditLimit ?? 0);
  if (creditLimit > 0) {
    const currentDebt = Math.max(0, -Number(user.balance));
    if (currentDebt + houseCut > creditLimit)
      throw new AppError(400, 'CREDIT_LIMIT_EXCEEDED', 'Credit limit exceeded');
  }
}
```

**Issue:** When `creditLimit = 0` (unlimited credit), ANY postpaid user can bet unlimited amounts. This is a **MAJOR FINANCIAL RISK**.

#### Game Joining Check
```typescript
if (user.paymentType !== 'postpaid' && user.balance < totalCost)
  throw new AppError(400, 'INSUFFICIENT_BALANCE', 'Insufficient balance');
```

**Issue:** Postpaid users can join games without ANY validation. No credit limit check here.

---

### Frontend (offlineApi.ts)

#### Offline-First Strategy for Postpaid
```typescript
const isPrepaidUser = !user || user.paymentType !== 'postpaid';

// Postpaid users → use server (real-time billing required)
if (!isPrepaidUser) {
  const result = await tryApi(() => api.post('/games', data));
  if (result.ok) { /* cache in background */ }
  // Server failed for postpaid → throw error (postpaid requires server)
  throw Object.assign(new Error('Server unreachable'), { code: 'SERVER_UNREACHABLE' });
}
```

**Issue:** Postpaid users CANNOT play offline. If server is down/slow, UX breaks completely.

---

### Frontend (authStore.ts)

#### Negative Balance Logic
```typescript
export function applyNegativeBalanceCheck(
  balance: number,
  paymentType: string | undefined,
  role: string,
  ...
) {
  // Postpaid users are EXEMPT from negative balance checks
  if (paymentType === 'postpaid' || role === 'admin' || role === 'agent') return false;
  // ... only prepaid users are locked
}
```

**Issue:** Postpaid users never trigger negative balance lockout, even if debt is massive.

---

### Frontend (sync.ts)

#### Balance Verification
```typescript
if (!user || user.paymentType === 'postpaid' || user.role === 'admin' || user.role === 'agent') 
  return true;
```

**Issue:** Postpaid users skip negative balance checks after sync. No enforcement.

---

### User Creation (userRoutes.ts)

#### Balance Top-Up Restriction
```typescript
if (user.paymentType !== 'prepaid') 
  throw new AppError(400, 'NOT_PREPAID', 'Balance top-up is only for prepaid users');
```

**Issue:** Cannot top-up postpaid user balances, only admins can adjust via API.

---

## Critical Issues Found

### 🔴 **Issue #1: Unlimited Credit Risk**
**Severity:** CRITICAL  
**Location:** `GameService.ts:65-74`

When `creditLimit = 0`, postpaid users have unlimited credit with NO enforcement.
- A player could rack up $100k in debt
- No daily/monthly caps exist
- No auto-suspension mechanism

**Example:**
```
creditLimit = 0 (unlimited)
balance = -$50,000
House: "Payment due, sir?"
Player: "Can I play one more game?"
House: "Sure! Bet $10k!" ← NO VALIDATION
```

---

### 🔴 **Issue #2: No Validation on Game Join**
**Severity:** HIGH  
**Location:** `GameService.ts:283`

`joinGame()` skips credit checks entirely for postpaid users.

```typescript
// CURRENT (DANGEROUS)
if (user.paymentType !== 'postpaid' && user.balance < totalCost)
  throw new AppError(400, 'INSUFFICIENT_BALANCE', 'Insufficient balance');

// Should be:
if (user.paymentType !== 'postpaid') {
  if (Number(user.balance) < totalCost) throw AppError(...);
} else {
  const creditLimit = Number(user.creditLimit ?? 0);
  if (creditLimit > 0) {
    const currentDebt = Math.max(0, -Number(user.balance));
    if (currentDebt + totalCost > creditLimit) throw AppError(...);
  }
}
```

---

### 🟡 **Issue #3: Offline Gameplay Blocked for Postpaid**
**Severity:** MEDIUM  
**Location:** `offlineApi.ts:261-277`

Postpaid users cannot play offline. If server is unreachable, game creation throws error.

```typescript
if (!isPrepaidUser) {
  const result = await tryApi(() => api.post('/games', data));
  if (result.ok) { /* ... */ }
  throw Object.assign(new Error('Server unreachable'), { code: 'SERVER_UNREACHABLE' });
}
```

**Impact:**
- Poor UX during network latency
- Cannot support remote areas
- Negative Stripe/payment delays break gameplay

---

### 🟡 **Issue #4: No Postpaid User Reporting**
**Severity:** MEDIUM  
**Location:** Missing entirely

No admin dashboard to:
- List postpaid users sorted by debt
- View credit usage vs limit
- Monitor default risk
- Set/adjust credit limits in real-time
- Auto-suspend users exceeding limits

---

### 🟡 **Issue #5: Sound Caching Strategy Unclear**
**Severity:** LOW  
**Location:** `db.ts:107-110`, `PlayBingo.tsx`

Postpaid users bypass sound cache but there's no UI toggle or clear indication.

```typescript
const bypassCache = useAuthStore.getState().user?.paymentType === 'postpaid';
playCachedSound(`/sounds/${file}`, 1, bypassCache).catch(() => {});
```

**Question:** Why? To save storage? To stream live? Not documented.

---

## Recommendations

### ✅ **Recommendation #1: Implement Credit Limit Validation**
**Priority:** CRITICAL

**Backend (GameService.ts)**

```typescript
// Add to createGame() BEFORE creating the game
if (user.paymentType === 'postpaid') {
  const creditLimit = Number(user.creditLimit ?? 0);
  if (creditLimit > 0) {  // 0 = unlimited, but we still need a safety cap
    const currentDebt = Math.max(0, -Number(user.balance));
    const totalExposure = currentDebt + houseCut;
    
    if (totalExposure > creditLimit) {
      throw new AppError(400, 'CREDIT_LIMIT_EXCEEDED', 
        `Current debt ${currentDebt} + house cut ${houseCut} exceeds limit ${creditLimit}`);
    }
  } else {
    // creditLimit = 0 means "unlimited", but enforce a system-wide cap
    const maxSystemCredit = env.MAX_POSTPAID_BALANCE ?? 10000; // env config
    if (Math.abs(Number(user.balance)) + houseCut > maxSystemCredit) {
      throw new AppError(400, 'CREDIT_LIMIT_EXCEEDED', 
        `System-wide credit cap exceeded (${maxSystemCredit})`);
    }
  }
}

// Add same check to joinGame()
async joinGame(gameId: string, userId: string, cartelaCount: number) {
  // ... existing validation ...
  const totalCost = game.betAmount * cartelaCount;
  
  if (user.paymentType === 'postpaid') {
    const creditLimit = Number(user.creditLimit ?? 0);
    if (creditLimit > 0) {
      const currentDebt = Math.max(0, -Number(user.balance));
      if (currentDebt + totalCost > creditLimit) {
        throw new AppError(400, 'CREDIT_LIMIT_EXCEEDED', 'Credit limit exceeded');
      }
    } else {
      const maxSystemCredit = env.MAX_POSTPAID_BALANCE ?? 10000;
      if (Math.abs(Number(user.balance)) + totalCost > maxSystemCredit) {
        throw new AppError(400, 'CREDIT_LIMIT_EXCEEDED', 'System credit cap exceeded');
      }
    }
  } else if (user.balance < totalCost) {
    throw new AppError(400, 'INSUFFICIENT_BALANCE', 'Insufficient balance');
  }
}
```

**Environment Variable (env.ts)**
```typescript
MAX_POSTPAID_BALANCE: parseFloat(process.env.MAX_POSTPAID_BALANCE || '10000'),
```

---

### ✅ **Recommendation #2: Add Postpaid User Admin Dashboard**
**Priority:** HIGH

**New Endpoint: GET /api/admin/postpaid-users**

```typescript
router.get('/postpaid-users', authorize('admin'), async (req: AuthRequest, res) => {
  const users = await AppDataSource.getRepository(User)
    .createQueryBuilder('u')
    .where('u.paymentType = :type', { type: 'postpaid' })
    .andWhere('u.balance < 0') // only users with debt
    .orderBy('u.balance', 'ASC') // worst debtors first
    .select([
      'u.id', 'u.username', 'u.email', 'u.balance', 
      'u.creditLimit', 'u.status', 'u.lastLoginAt'
    ])
    .getMany();
  
  // Enrich with game count & last activity
  const enriched = await Promise.all(users.map(async (u) => {
    const recentGames = await AppDataSource.getRepository(Game)
      .count({ where: { creatorId: u.id, status: 'finished' } });
    return {
      ...u,
      debtPercentage: Number(u.creditLimit) > 0 
        ? (Math.abs(Number(u.balance)) / Number(u.creditLimit)) * 100 
        : 0,
      recentGames,
    };
  }));
  
  res.json({ success: true, data: enriched });
});
```

**New Endpoint: PATCH /api/admin/users/:id/credit-limit**

```typescript
router.patch('/admin/users/:id/credit-limit', authorize('admin'), async (req: AuthRequest, res) => {
  const { creditLimit } = req.body;
  if (typeof creditLimit !== 'number' || creditLimit < 0) {
    throw new AppError(400, 'INVALID_CREDIT_LIMIT', 'Credit limit must be >= 0');
  }
  
  await AppDataSource.getRepository(User).update(req.params.id, { creditLimit });
  res.json({ success: true, data: { creditLimit } });
});
```

**New Endpoint: PATCH /api/admin/users/:id/auto-suspend**

```typescript
router.patch('/admin/users/:id/auto-suspend', authorize('admin'), async (req: AuthRequest, res) => {
  const user = await AppDataSource.getRepository(User).findOne({ where: { id: req.params.id } });
  if (user?.paymentType !== 'postpaid') {
    throw new AppError(400, 'NOT_POSTPAID', 'Only postpaid users can be auto-suspended');
  }
  
  const creditLimit = Number(user.creditLimit ?? 0);
  const currentDebt = Math.abs(Number(user.balance));
  
  if (creditLimit > 0 && currentDebt >= creditLimit) {
    // Auto-suspend to prevent further debt
    await AppDataSource.getRepository(User).update(req.params.id, { status: 'suspended' });
  }
  
  res.json({ success: true });
});
```

---

### ✅ **Recommendation #3: Add Postpaid Offline Fallback**
**Priority:** MEDIUM

**offlineApi.ts**

Instead of throwing error when offline, allow postpaid users to play offline with queued settlement:

```typescript
// CURRENT (BROKEN FOR OFFLINE)
if (!isPrepaidUser) {
  const result = await tryApi(() => api.post('/games', data));
  if (result.ok) { /* ... */ }
  throw Object.assign(new Error('Server unreachable'), { code: 'SERVER_UNREACHABLE' });
}

// RECOMMENDED (OFFLINE-CAPABLE)
if (!isPrepaidUser) {
  if (navigator.onLine) {
    const result = await tryApi(() => api.post('/games', data));
    if (result.ok) {
      // ... cache & return ...
      return result.data;
    }
    // Fall through to offline mode if network error (not auth error)
  }
  
  // Offline mode: Create game locally, queue for sync
  const offlineGame = {
    id: crypto.randomUUID(),
    creatorId: user.id,
    status: 'offline-pending',  // Special status
    betAmount: data.betAmountPerCartela,
    cartelaCount: data.cartelaIds.length,
    totalBets: data.betAmountPerCartela * data.cartelaIds.length,
    houseCut: (data.betAmountPerCartela * data.cartelaIds.length) * (data.housePercentage ?? 10) / 100,
    prizePool: 0,
    calledNumbers: [],
    winnerIds: [],
    createdAt: new Date(),
  };
  
  await dbPut('games', offlineGame);
  _queueGameCreation(offlineGame.id, data);  // Queue for sync
  
  return { success: true, data: offlineGame };
}
```

---

### ✅ **Recommendation #4: Add Postpaid User Monitoring UI**
**Priority:** HIGH

**New Page: admin/PostpaidDashboard.tsx**

```typescript
export const PostpaidDashboard: React.FC = () => {
  const { data: users = [], isLoading } = useQuery({
    queryKey: ['postpaid-users'],
    queryFn: () => adminApi.getPostpaidUsers(),
    refetchInterval: 30000,
  });
  
  return (
    <div className="space-y-4">
      <h1>Postpaid Users - Credit Status</h1>
      
      <table>
        <thead>
          <tr>
            <th>User</th>
            <th>Current Debt</th>
            <th>Credit Limit</th>
            <th>Usage %</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map(user => (
            <tr key={user.id}>
              <td>{user.username}</td>
              <td>${Math.abs(user.balance).toFixed(2)}</td>
              <td>${user.creditLimit === 0 ? '∞' : user.creditLimit}</td>
              <td>
                <ProgressBar 
                  value={user.debtPercentage} 
                  color={user.debtPercentage > 80 ? 'red' : 'yellow'}
                />
              </td>
              <td>
                <Badge status={user.status} />
              </td>
              <td>
                <Button onClick={() => suspendUser(user.id)}>Suspend</Button>
                <Button onClick={() => adjustCreditLimit(user.id)}>Adjust Limit</Button>
                <Button onClick={() => settleDebt(user.id)}>Settle</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
```

---

### ✅ **Recommendation #5: Add Postpaid Settle/Billing Endpoints**
**Priority:** HIGH

**New Endpoint: POST /api/postpaid/settle/:userId**

```typescript
router.post('/postpaid/settle/:userId', authorize('admin'), async (req: AuthRequest, res) => {
  const user = await AppDataSource.getRepository(User).findOne({ where: { id: req.params.userId } });
  if (user?.paymentType !== 'postpaid') {
    throw new AppError(400, 'NOT_POSTPAID', 'User is not postpaid');
  }
  
  const currentDebt = Math.abs(Number(user.balance));
  if (currentDebt === 0) {
    return res.json({ success: true, message: 'No debt to settle' });
  }
  
  // Create settlement transaction
  const settlement = await AppDataSource.getRepository(Transaction).create({
    userId: user.id,
    type: 'settlement',
    amount: currentDebt,
    status: 'pending_payment',
    description: `Settlement of postpaid account debt: $${currentDebt.toFixed(2)}`,
  });
  
  await AppDataSource.getRepository(Transaction).save(settlement);
  
  res.json({ 
    success: true, 
    data: { 
      settlement, 
      invoiceUrl: `${env.FRONTEND_URL}/invoices/${settlement.id}`,
    } 
  });
});
```

---

### ✅ **Recommendation #6: Logging & Alerts for Postpaid Activity**
**Priority:** MEDIUM

**Add to GameService.ts**

```typescript
import { AuditLog } from '../../../shared/domain/AuditLog';

async createGame(userId: string, dto: CreateGameDTO): Promise<Game> {
  // ... existing validation ...
  
  if (user.paymentType === 'postpaid') {
    const creditLimit = Number(user.creditLimit ?? 0);
    const currentDebt = Math.max(0, -Number(user.balance));
    const utilizationPercent = creditLimit > 0 
      ? (currentDebt / creditLimit) * 100 
      : 0;
    
    // Log every postpaid game creation
    await AppDataSource.getRepository(AuditLog).save({
      userId,
      action: 'CREATE_GAME_POSTPAID',
      details: {
        gameId: game.id,
        houseCut,
        newDebt: currentDebt + houseCut,
        creditLimit,
        utilizationPercent,
      },
      ipAddress: req?.ip,
      timestamp: new Date(),
    });
    
    // Alert if exceeding 80% of credit limit
    if (creditLimit > 0 && utilizationPercent >= 80) {
      logger.warn('Postpaid user nearing credit limit', {
        userId,
        utilizationPercent,
        creditLimit,
      });
      // Could trigger email alert to admin
    }
  }
}
```

---

## Summary Table

| Issue | Severity | Fix | Effort |
|-------|----------|-----|--------|
| Unlimited credit risk | 🔴 CRITICAL | Implement credit checks on create & join | High |
| No validation on join | 🔴 CRITICAL | Add credit limit validation | Medium |
| Blocked offline gameplay | 🟡 MEDIUM | Queue games for sync | High |
| No admin visibility | 🟡 MEDIUM | Add postpaid dashboard | High |
| No settlement process | 🟡 MEDIUM | Add billing endpoints | Medium |
| Poor logging | 🟡 MEDIUM | Enhanced audit trail | Low |

---

## Configuration Checklist

```bash
# Add to .env
MAX_POSTPAID_BALANCE=10000          # Safety cap for unlimited credit
POSTPAID_ALERT_THRESHOLD=80         # % of credit limit to trigger alert
POSTPAID_AUTO_SUSPEND=true          # Auto-suspend when limit exceeded
SETTLEMENT_REMINDER_DAYS=30         # Days before settlement reminder
```

---

## Testing Recommendations

### Unit Tests
```typescript
// Test credit limit enforcement
test('Postpaid user cannot create game exceeding credit limit', async () => {
  const user = { paymentType: 'postpaid', creditLimit: 1000, balance: -800 };
  // Trying to bet $300 should fail (800 + 300 > 1000)
  expect(() => gameService.createGame(user.id, { cartelaIds, betAmountPerCartela: 300 }))
    .toThrow('CREDIT_LIMIT_EXCEEDED');
});

// Test unlimited credit cap
test('Postpaid user with creditLimit=0 cannot exceed system max', async () => {
  const user = { paymentType: 'postpaid', creditLimit: 0, balance: -9999 };
  // MAX_POSTPAID_BALANCE = 10000, so balance should fail
  expect(() => gameService.createGame(user.id, { ... }))
    .toThrow('CREDIT_LIMIT_EXCEEDED');
});
```

### Integration Tests
- Test postpaid game creation → validation → settlement flow
- Test offline game queue sync for postpaid users
- Test credit limit enforcement across concurrent games

