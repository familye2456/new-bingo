# Implementation Plan: Manager Agent Role

## Overview

Most of the agent role implementation is already in place. The remaining work is a backend query fix for user list filtering and a frontend guard to hide the "Create Agent" option from agents.

## Tasks

- [x] 1. Fix agent user-list query in `userRoutes.ts`
  - [x] 1.1 Update the `GET /` agent branch to include `created_by IS NULL` users
    - In `fidel-bingo/backend/src/modules/user/interfaces/userRoutes.ts`, change the agent query builder to use `.where('u.role = :role', { role: 'player' }).andWhere('(u.created_by = :id OR u.created_by IS NULL)', { id: actor.id })`
    - Remove the current `.andWhere('u.created_by = :id', ...)` clause and replace with the combined OR condition
    - _Requirements: 4.1, 4.2, 4.4_

  - [x] 1.2 Write property test for ownership filtering logic
    - **Property 1: Agent sees own users** — for any agent A, every user returned by `GET /` has `createdBy === A.id` or `createdBy === null`
    - **Property 2: Admin sees all players** — admin always receives the full player set regardless of `createdBy`
    - **Validates: Requirements 4.1, 4.2, 4.3**

- [x] 2. Frontend: hide "Create Agent" from agent users in `UserManagement.tsx`
  - [x] 2.1 Verify and enforce `isAdmin` guard on the "New Agent" button and `create-agent` modal
    - In `fidel-bingo/frontend/src/pages/admin/UserManagement.tsx`, confirm the "New Agent" button is already wrapped in `{isAdmin && ...}` — it is; no change needed there
    - Confirm the `modal === 'create-agent' && isAdmin` guard on the modal render — it is; no change needed
    - Confirm the "Agents" tab is wrapped in `{isAdmin && ...}` — it is; no change needed
    - Confirm the role `<select>` inside the create-user modal is wrapped in `{modal === 'create' && isAdmin && ...}` — it is; no change needed
    - If any of the above guards are missing, add them
    - _Requirements: 5.3, 11.4_

  - [x] 2.2 Verify `UserDetail.tsx` has no agent-creation entry point
    - Inspect `fidel-bingo/frontend/src/pages/admin/UserDetail.tsx` for any "Create Agent" button or role selector — there is none; no change needed
    - _Requirements: 5.3_

- [x] 3. Checkpoint — Ensure all tests pass
  - Run the backend test suite and confirm the updated query returns the correct user sets for both agent and admin callers.
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- The `assertAgentOwns` helper already handles the `createdBy IS NULL` case for single-user operations; only the list query needed fixing
- All other features (enum, `createdBy` column, auth middleware, `AdminLayout` role display, `ProtectedRoute` routing) are already implemented
