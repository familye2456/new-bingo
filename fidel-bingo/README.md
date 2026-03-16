# Fidel Bingo — Enterprise Platform

Real-time multiplayer bingo platform with offline-first PWA architecture.

## Quick Start

### With Docker (recommended)
```bash
cd fidel-bingo
docker-compose up
```
- Frontend: http://localhost:80
- API: http://localhost:3000
- Health: http://localhost:3000/health
- Metrics: http://localhost:3000/metrics

### Local Development

**Backend**
```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

**Frontend**
```bash
cd frontend
npm install
npm run dev
```
Frontend runs on http://localhost:5173

## Architecture

```
backend/src/
├── modules/
│   ├── auth/        # JWT auth, refresh tokens
│   ├── game/        # Game logic, cartela generation, winner detection
│   ├── payment/     # Transactions, accounts
│   └── user/        # User profiles
├── shared/          # Middleware, logger, metrics
└── config/          # DB, Redis, env
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/auth/register | Register |
| POST | /api/auth/login | Login |
| POST | /api/auth/refresh | Refresh tokens |
| POST | /api/auth/logout | Logout |
| GET | /api/games | List games |
| POST | /api/games | Create game |
| GET | /api/games/:id | Get game |
| POST | /api/games/:id/join | Join game |
| POST | /api/games/:id/start | Start game |
| POST | /api/games/:id/call | Call number |
| POST | /api/games/:id/bingo | Claim bingo |

## WebSocket Events

| Event | Direction | Description |
|-------|-----------|-------------|
| join_game | client→server | Join game room |
| call_number | client→server | Call next number |
| mark_number | client→server | Mark number on cartela |
| claim_bingo | client→server | Claim win |
| number_called | server→client | Number was called |
| game_finished | server→client | Game ended |
| game_state | server→client | Full game state |
