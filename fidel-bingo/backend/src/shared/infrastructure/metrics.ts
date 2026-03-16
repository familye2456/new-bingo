import client from 'prom-client';

const register = new client.Registry();
client.collectDefaultMetrics({ register });

export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.1, 0.5, 1, 2, 5],
  registers: [register],
});

export const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});

export const activeGames = new client.Gauge({
  name: 'active_games_total',
  help: 'Number of active games',
  registers: [register],
});

export const activePlayers = new client.Gauge({
  name: 'active_players_total',
  help: 'Number of currently active players',
  registers: [register],
});

export const revenueTotal = new client.Counter({
  name: 'revenue_total',
  help: 'Total revenue in cents',
  labelNames: ['currency'],
  registers: [register],
});

export { register };
