import { Request, Response, NextFunction } from 'express';
import { httpRequestDuration, httpRequestsTotal } from '../infrastructure/metrics';

export const metricsMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    const route = req.route?.path || req.path;
    const status = res.statusCode.toString();

    httpRequestDuration.labels(req.method, route, status).observe(duration);
    httpRequestsTotal.labels(req.method, route, status).inc();
  });

  next();
};
