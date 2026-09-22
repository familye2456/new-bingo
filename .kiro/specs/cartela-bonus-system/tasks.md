# Implementation Tasks: Cartela Bonus System

## Task Overview

This implementation replaces the existing daily-profit-threshold bonus system with a simpler per-game free cartela bonus system. The work is organized into backend changes first (database, API, game logic), followed by frontend updates (UI changes, API integration).

---

## 1. Database Schema Updates

### 1.1 Create database migration for cartelaBonusEnabled field
- [x] Create TypeORM migration file in `fidel-bingo/backend/src/migrations/`
- [x] Add `cartela_bonus_enabled BOOLEAN NOT NULL DEFAULT FALSE` column to users table
- [x] Test migration up/down on development database
- [x] Verify existing users get `false` default value

**Files to modify:**
- `fidel-bingo/backend/src/migrations/[timestamp]-AddCartelaBonusEnabled.ts` (new)

**Acceptance criteria:**
- Migration runs without errors
- All existing users have `cartelaBonusEnabled = false`
- New users created after migration have the field available

---

## 2. Backend User Entity Updates

### 2.1 Update User entity with cartelaBonusEnabled field
- [x] Add `cartelaBonusEnabled: boolean` property to User entity
- [x] Add TypeORM column decorator with default false
- [x] Update `sanitize()` method to include `cartelaBonusEnabled` in returned object
- [x] Write unit tests for sanitize method including new field

**Files to modify:**
- `fidel-bingo/backend/src/modules/user/domain/User.ts`
- `fidel-bingo/backend/src/modules/user/domain/User.test.ts`

**Acceptance criteria:**
- User entity compiles without TypeScript errors
- `sanitize()` returns `cartelaBonusEnabled` field
- Unit tests pass for sanitize method

---

## 3. Backend API Endpoint for Bonus Toggle

### 3.1 Create PATCH /users/:id/cartela-bonus endpoint
- [x] Add route handler in `userRoutes.ts`
- [x] Implement authentication and authorization (admin/agent only)
- [x] Add request validation for boolean `enabled` field
- [x] Implement agent ownership check using existing `assertAgentOwns`
- [x] Return sanitized user object on success
- [x] Add comprehensive error handling (400, 403, 404)

**Files to modify:**
- `fidel-bingo/backend/src/modules/user/interfaces/userRoutes.ts`

**Sub-tasks:**
- [x] 3.1.1 Add route definition with proper middleware
- [x] 3.1.2 Implement request body validation
- [x] 3.1.3 Add database update logic
- [x] 3.1.4 Implement error responses
- [x] 3.1.5 Add endpoint documentation/comments

**Acceptance criteria:**
- Endpoint accepts valid boolean values for `enabled`
- Returns 400 for non-boolean values
- Returns 403 for agents accessing other agents' users
- Returns 404 for non-existent users
- Successfully updates database and returns sanitized user

### 3.2 Add comprehensive endpoint tests
- [x] Write integration tests for PATCH /users/:id/cartela-bonus
- [x] Test admin access to any user
- [x] Test agent access restrictions
- [x] Test validation error handling
- [x] Test successful toggle operations

**Files to modify:**
- `fidel-bingo/backend/src/modules/user/interfaces/userRoutes.test.ts`

**Acceptance criteria:**
- All test scenarios pass
- Code coverage includes error paths
- Tests verify database state changes

---

## 4. Game Service Updates

### 4.1 Remove existing daily bonus logic
- [x] Remove `applyDailyBonusIfEligible` method from GameService
- [x] Remove all calls to daily bonus logic in `createGame`
- [x] Clean up any unused imports or dependencies

**Files to modify:**
- `fidel-bingo/backend/src/modules/game/application/GameService.ts`

**Acceptance criteria:**
- No references to daily bonus logic remain
- GameService compiles without errors
- Existing game creation tests still pass

### 4.2 Implement free cartela bonus in createGame
- [x] Add `cartelaBonusEnabled` to user query in createGame
- [x] Implement bonus credit logic within existing transaction
- [x] Add balance increment for eligible users
- [x] Create bonus transaction record with proper metadata
- [x] Ensure atomic operation (balance + transaction)

**Files to modify:**
- `fidel-bingo/backend/src/modules/game/application/GameService.ts`

**Sub-tasks:**
- [x] 4.2.1 Update user query to include cartelaBonusEnabled field
- [x] 4.2.2 Add conditional bonus logic after game creation
- [x] 4.2.3 Implement balance increment using manager.increment
- [x] 4.2.4 Create transaction record with correct metadata
- [x] 4.2.5 Ensure both operations use same transaction manager

**Acceptance criteria:**
- Eligible users receive bonus credit equal to betAmount
- Non-eligible users receive no bonus
- Zero bet games receive no bonus regardless of eligibility
- Balance and transaction are created atomically
- Game creation still works for all existing scenarios

### 4.3 Add unit tests for new bonus logic
- [x] Write tests for eligible user bonus application
- [x] Write tests for non-eligible user scenarios
- [x] Write tests for zero bet edge cases
- [x] Write tests for transaction atomicity
- [x] Mock transaction manager for isolated testing

**Files to modify:**
- `fidel-bingo/backend/src/modules/game/application/GameService.test.ts`

**Acceptance criteria:**
- Tests cover all bonus logic paths
- Tests verify correct transaction metadata
- Tests ensure atomicity behavior

---

## 5. Remove Legacy Bonus Endpoint

### 5.1 Remove /games/bonus/today endpoint
- [x] Delete route handler from gameRoutes.ts
- [x] Remove any associated middleware or utilities
- [x] Update any route documentation
- [x] Add test to verify 404 response

**Files to modify:**
- `fidel-bingo/backend/src/modules/game/interfaces/gameRoutes.ts`
- `fidel-bingo/backend/src/modules/game/interfaces/gameRoutes.test.ts`

**Acceptance criteria:**
- Route no longer exists
- Returns 404 when accessed
- No broken references remain

---

## 6. Frontend API Integration

### 6.1 Add setCartelaBonus API method
- [x] Add `setCartelaBonus` method to `adminApi` in api.ts
- [x] Implement PATCH request to `/users/:id/cartela-bonus`
- [x] Add proper TypeScript types for request/response
- [x] Add error handling for API responses

**Files to modify:**
- `fidel-bingo/frontend/src/services/api.ts`
- `fidel-bingo/frontend/src/types/api.ts` (if separate types file exists)

**Acceptance criteria:**
- API method properly typed
- Correctly calls backend endpoint
- Handles success and error responses

---

## 7. UserManagement UI Updates

### 7.1 Update UserRecord interface
- [x] Add `cartelaBonusEnabled: boolean` to UserRecord interface
- [x] Update any existing type definitions
- [x] Ensure interface matches backend User.sanitize() output

**Files to modify:**
- `fidel-bingo/frontend/src/pages/admin/UserManagement.tsx`

### 7.2 Add bonus toggle UI component
- [x] Create toggle switch component for cartela bonus
- [x] Add useMutation hook for setCartelaBonus API call
- [x] Implement loading states during toggle operations
- [x] Add error handling and user feedback
- [x] Integrate toggle into both desktop table and mobile cards

**Files to modify:**
- `fidel-bingo/frontend/src/pages/admin/UserManagement.tsx`

**Sub-tasks:**
- [x] 7.2.1 Design toggle switch component (pill or checkbox style)
- [x] 7.2.2 Implement mutation hook with proper invalidation
- [x] 7.2.3 Add loading state indicators
- [x] 7.2.4 Implement error messaging
- [x] 7.2.5 Add toggle to desktop table Actions column
- [x] 7.2.6 Add toggle to mobile card layout

**Acceptance criteria:**
- Toggle reflects current cartelaBonusEnabled state
- Loading states prevent double-clicks
- Success updates the UI immediately
- Errors show clear user feedback
- Works on both desktop and mobile layouts

---

## 8. UserDashboard Cleanup

### 8.1 Remove daily bonus banner components
- [x] Remove `useQuery(['bonus-today'])` query
- [x] Remove bonus banner JSX blocks
- [x] Remove any unused imports or dependencies
- [x] Clean up any related state management

**Files to modify:**
- `fidel-bingo/frontend/src/pages/user/UserDashboard.tsx`

**Acceptance criteria:**
- No daily bonus UI elements remain
- Dashboard loads without errors
- No unused code remains

---

## 9. BalanceHistory Updates

### 9.1 Update bonus transaction labeling
- [x] Verify TX_LABEL['bonus'] configuration
- [x] Update label to "Free Cartela" if needed
- [x] Ensure '+' sign and correct color (#fbbf24)
- [x] Test rendering with bonus transactions

**Files to modify:**
- `fidel-bingo/frontend/src/pages/user/BalanceHistory.tsx`

**Acceptance criteria:**
- Bonus transactions show "Free Cartela" label
- Displays with '+' sign prefix
- Uses correct yellow color
- Totals calculation includes bonus amounts

---

## 10. Property-Based Testing

### 10.1 Backend property tests
- [x] Property 1: Eligible user credit round-trip test
- [x] Property 2: No bonus for non-eligible users test
- [x] Property 3: Bonus credit atomicity invariant test
- [x] Property 4: Agent ownership enforcement test
- [x] Property 5: Invalid enabled values rejection test
- [x] Property 6: cartelaBonusEnabled round-trip test

**Files to create/modify:**
- `fidel-bingo/backend/src/modules/game/application/GameService.pbt.test.ts` (new)
- `fidel-bingo/backend/src/modules/user/interfaces/userRoutes.pbt.test.ts` (new)

**Sub-tasks:**
- [x] 10.1.1 Set up fast-check test infrastructure
- [x] 10.1.2 Implement Property 1 test (eligible user bonus)
- [x] 10.1.3 Implement Property 2 test (no bonus for ineligible)
- [x] 10.1.4 Implement Property 3 test (atomicity)
- [x] 10.1.5 Implement Property 4 test (agent ownership)
- [x] 10.1.6 Implement Property 5 test (validation)
- [x] 10.1.7 Implement Property 6 test (sanitize round-trip)

**Acceptance criteria:**
- All property tests run minimum 100 iterations
- Each test includes proper feature/property comment tags
- Tests cover edge cases and error conditions
- Mock dependencies appropriately

### 10.2 Frontend property tests
- [x] Property 7: BalanceHistory renders bonus transactions correctly
- [x] Property 8: BalanceHistory totals include all bonus amounts

**Files to create/modify:**
- `fidel-bingo/frontend/src/pages/user/BalanceHistory.pbt.test.ts` (new)

**Acceptance criteria:**
- Tests use Vitest + fast-check
- Minimum 100 iterations per test
- Proper feature/property comment tags
- Validates UI rendering and calculations

---

## 11. Integration Testing & QA

### 11.1 End-to-end testing
- [ ] Test complete bonus toggle workflow (admin/agent → user)
- [ ] Test game creation with bonus for eligible users
- [ ] Test game creation without bonus for non-eligible users
- [ ] Verify balance history shows free cartela transactions
- [ ] Test error scenarios and edge cases

**Acceptance criteria:**
- Full workflow works from UI to database
- All user roles work correctly
- Error cases are handled gracefully
- Balance calculations are accurate

### 11.2 Performance and security review
- [ ] Review database query performance with new field
- [ ] Verify authorization checks are comprehensive
- [ ] Test with large numbers of transactions
- [ ] Validate input sanitization and XSS protection

**Acceptance criteria:**
- No performance regressions
- Security vulnerabilities addressed
- Scalable with transaction volume

---

## 12. Documentation & Deployment

### 12.1 Update API documentation
- [ ] Document new PATCH /users/:id/cartela-bonus endpoint
- [ ] Update any existing API documentation
- [ ] Add migration instructions for deployment

### 12.2 Create deployment plan
- [ ] Plan database migration execution
- [ ] Coordinate backend and frontend deployments
- [ ] Prepare rollback procedures if needed
- [ ] Test deployment process in staging

**Acceptance criteria:**
- Clear deployment instructions
- Tested migration process
- Rollback plan available
- Staging environment validated

---

## Task Dependencies

```
1.1 → 2.1 → 4.1, 4.2 → 4.3
3.1 → 3.2
5.1
6.1 → 7.1, 7.2
8.1
9.1
10.1, 10.2 (can run in parallel with development)
11.1 → 11.2 → 12.1, 12.2
```

**Critical Path:** Database migration → User entity → Game service changes → Frontend integration → Testing → Deployment

**Estimated Timeline:** 
- Backend changes: 3-4 days
- Frontend changes: 2-3 days  
- Testing & QA: 2-3 days
- **Total: 7-10 days**