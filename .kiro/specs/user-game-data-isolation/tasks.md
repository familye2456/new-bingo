# User Game Data Isolation - Tasks

## Tasks

- [x] 1. Exploratory bug condition checking
  - [x] 1.1 Write a test that seeds a game with cartelas for two distinct users, calls the `GET /games/:gameId/cartelas` handler as User A, and asserts that User B's cartela is present in the response (confirms the data-leak on unfixed code)
  - [x] 1.2 Write a test that calls the handler as a user with no cartelas in the game and asserts the response is non-empty on unfixed code (should be empty after fix)
  - [x] 1.3 Run the exploratory tests against the unfixed code and confirm the expected counterexamples are surfaced

- [x] 2. Fix implementation
  - [x] 2.1 In `fidel-bingo/backend/src/modules/game/interfaces/gameRoutes.ts`, update the `GET /:gameId/cartelas` handler to branch on `req.user.role`: for non-admin users add `userId: req.user!.id` to the `gcRepo.find` where clause; for admin users keep the existing unfiltered query

- [x] 3. Fix checking (Property 1)
  - [x] 3.1 Write a unit test: non-admin user with cartelas in the game receives only their own cartelas after the fix
  - [x] 3.2 Write a unit test: non-admin user with no cartelas in the game receives an empty array after the fix
  - [x] 3.3 Write a property-based test: for any generated set of (gameId, userId) cartela entries, the non-admin response contains only entries matching the requesting userId (validates Property 1)
  - [x] 3.4 Run fix-checking tests against the fixed code and confirm all pass

- [ ] 4. Preservation checking (Property 2)
  - [x] 4.1 Write a unit test: admin user receives all cartelas for a game regardless of userId after the fix
  - [-] 4.2 Write a property-based test: for any generated game/cartela configuration, the admin response equals the full unfiltered set (validates Property 2)
  - [ ] 4.3 Write integration tests verifying that `/games/mine`, `GET /games`, and mutation endpoints (join, start, finish) behave identically before and after the fix
  - [ ] 4.4 Run preservation tests and confirm all pass

- [ ] 5. Integration verification
  - [ ] 5.1 Write an end-to-end integration test: two users join a game, each calls the cartelas endpoint, each receives only their own cartela data
  - [ ] 5.2 Verify the offline cache (IndexedDB) scenario: after the fix, the response used to populate the cache contains only the requesting user's own cartela data
