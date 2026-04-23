# Bugfix Requirements Document

## Introduction

Users are seeing game data that belongs to other users. The `GET /games/:gameId/cartelas`
endpoint returns all cartelas linked to a game regardless of who is requesting them,
exposing other players' cartela numbers, bet amounts, and win state. Each user should
only ever receive their own cartela data.

The bug is isolated to the game cartelas endpoint in `gameRoutes.ts`. The `listGames`
controller already scopes results by `creatorId` for non-admin users, and the `/games/mine`
route correctly filters by `userId` on `game_cartelas`. The cartelas sub-route is the
missing piece.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN an authenticated user requests `GET /games/:gameId/cartelas` THEN the system returns all cartelas joined to that game, including cartelas belonging to other users

1.2 WHEN the offline cache is populated from `GET /games/:gameId/cartelas` THEN the system stores other users' cartela data (numbers, bet amounts, win state) in the requesting user's local IndexedDB

### Expected Behavior (Correct)

2.1 WHEN an authenticated user requests `GET /games/:gameId/cartelas` THEN the system SHALL return only the cartelas whose `userId` matches the authenticated user's ID

2.2 WHEN the offline cache is populated from `GET /games/:gameId/cartelas` THEN the system SHALL store only the authenticated user's own cartela data in IndexedDB

### Unchanged Behavior (Regression Prevention)

3.1 WHEN an admin user requests `GET /games/:gameId/cartelas` THEN the system SHALL CONTINUE TO return all cartelas for that game (admins require full visibility)

3.2 WHEN a user requests `GET /games/mine` THEN the system SHALL CONTINUE TO return only games where that user's `userId` appears in `game_cartelas`

3.3 WHEN a non-admin user requests `GET /games` THEN the system SHALL CONTINUE TO return only games where `creatorId` matches the authenticated user's ID

3.4 WHEN a user creates, starts, calls a number, or finishes a game THEN the system SHALL CONTINUE TO enforce `creatorId` ownership checks as before
