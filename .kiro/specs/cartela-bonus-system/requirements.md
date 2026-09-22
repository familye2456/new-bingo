# Requirements Document

## Introduction

This feature replaces the existing daily-profit-threshold bonus system with a per-game **free cartela bonus**. Every time a user starts a new game, the system automatically selects one cartela from the user's selected cartelas and credits the user's balance with an amount equal to the bet amount — effectively making that one cartela free. This bonus is not available to all users; it must be explicitly enabled per user by an admin or agent.

## Glossary

- **Bonus_System**: The subsystem responsible for calculating and applying the free-cartela credit on game creation.
- **Free_Cartela_Credit**: The automatic balance credit equal to `betAmount` applied to an eligible user at game start, representing one free cartela.
- **Eligible_User**: A user for whom the `cartelaBonusEnabled` flag has been set to `true` by an admin or agent.
- **Game**: A single bingo game session created by a player/operator, identified by a UUID.
- **GameService**: The backend service that handles game creation, number calling, and game completion.
- **Admin**: A user with `role = 'admin'` who can enable/disable the cartela bonus for any user.
- **Agent**: A user with `role = 'agent'` who can enable/disable the cartela bonus for users they manage.
- **User**: A registered player in the system.
- **betAmount**: The stake amount in Birr paid per cartela for a given game.
- **cartelaBonusEnabled**: A boolean flag stored on the `users` table that controls whether a user receives the free-cartela credit.

---

## Requirements

### Requirement 1: Remove the Existing Bonus System

**User Story:** As an admin, I want the old daily-profit-threshold bonus removed, so that it does not conflict with the new per-game free cartela bonus.

#### Acceptance Criteria

1. THE GameService SHALL NOT execute the `applyDailyBonusIfEligible` method after a game finishes or a bingo is claimed.
2. THE GameService SHALL NOT expose the `/games/bonus/today` API endpoint after the old system is removed.
3. THE UserDashboard SHALL NOT display the daily bonus progress banner or the daily bonus applied banner after the old system is removed.

---

### Requirement 2: Store the Cartela Bonus Flag on the User

**User Story:** As a system architect, I want a boolean flag on the user record to control cartela bonus eligibility, so that the bonus can be selectively granted per user.

#### Acceptance Criteria

1. THE User entity SHALL include a `cartelaBonusEnabled` boolean column with a default value of `false`.
2. WHEN the `cartelaBonusEnabled` column is added, THE Database_Migration SHALL apply without data loss to existing user records.
3. THE User.sanitize method SHALL include `cartelaBonusEnabled` in the returned safe user object so frontends can read it.

---

### Requirement 3: Apply Free Cartela Credit on Every Game Start

**User Story:** As an eligible player, I want one cartela to be free every game, so that my effective cost per game is reduced by the value of one bet.

#### Acceptance Criteria

1. WHEN an Eligible_User creates a new game with at least one cartela, THE GameService SHALL credit the user's balance with an amount equal to `betAmount`.
2. THE GameService SHALL record the credit as a transaction with `transactionType = 'bonus'`, `amount = betAmount`, `status = 'completed'`, and a description of `"Free cartela bonus for game {gameId}"`.
3. WHEN a non-eligible user creates a game, THE GameService SHALL NOT apply any Free_Cartela_Credit.
4. THE Free_Cartela_Credit SHALL be applied within the same database transaction as game creation so that neither partial state can persist.
5. WHEN a game is created with `betAmount = 0`, THE GameService SHALL NOT apply a Free_Cartela_Credit.

---

### Requirement 4: Admin and Agent Can Enable the Bonus per User

**User Story:** As an admin or agent, I want to enable or disable the cartela bonus for individual users, so that only designated users benefit from the feature.

#### Acceptance Criteria

1. THE User_API SHALL expose a `PATCH /users/:id/cartela-bonus` endpoint that accepts `{ "enabled": true | false }`.
2. WHEN an admin calls `PATCH /users/:id/cartela-bonus`, THE User_API SHALL update `cartelaBonusEnabled` for the target user regardless of who manages that user.
3. WHEN an agent calls `PATCH /users/:id/cartela-bonus`, THE User_API SHALL update `cartelaBonusEnabled` only if the agent is the `createdBy` owner of that user; otherwise THE User_API SHALL return a `403 FORBIDDEN` error.
4. WHEN the request body contains a value other than `true` or `false` for `enabled`, THE User_API SHALL return a `400 VALIDATION_ERROR` response.
5. THE User_API SHALL return the updated user object (via `sanitize()`) on success.

---

### Requirement 5: Admin and Agent UI Toggle for the Bonus

**User Story:** As an admin or agent, I want a UI toggle to enable or disable the cartela bonus for a user, so that I can manage eligibility without using raw API calls.

#### Acceptance Criteria

1. THE UserManagement page SHALL display a bonus toggle control for each user in the user list or user detail view.
2. WHEN an admin or agent toggles the bonus switch for a user, THE UserManagement SHALL call `PATCH /users/:id/cartela-bonus` with the new value.
3. WHILE the toggle mutation is pending, THE UserManagement SHALL show a loading state on that control to prevent double-submission.
4. WHEN the toggle mutation succeeds, THE UserManagement SHALL refresh the user list to reflect the updated `cartelaBonusEnabled` state.
5. IF the toggle mutation fails, THE UserManagement SHALL display an error message indicating the failure.

---

### Requirement 6: Free Cartela Credit Visible in Balance History

**User Story:** As a player, I want to see the free cartela credits in my balance history, so that I can verify the bonus was applied correctly.

#### Acceptance Criteria

1. THE BalanceHistory page SHALL display transactions with `transactionType = 'bonus'` with a `+` sign and a label of `"Free Cartela"`.
2. THE BalanceHistory page SHALL include free cartela bonus amounts in the totals summary under a `"Bonuses"` label.
