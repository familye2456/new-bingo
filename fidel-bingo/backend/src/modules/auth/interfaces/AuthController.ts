import { Request, Response } from 'express';
import { AuthService } from '../application/AuthService';
import { env } from '../../../config/env';

const authService = new AuthService();

const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  secure: true,
  sameSite: 'none' as const,
  maxAge,
});

export const register = async (req: Request, res: Response) => {
  const user = await authService.register(req.body);
  res.status(201).json({ success: true, data: user.sanitize() });
};

export const login = async (req: Request, res: Response) => {
  const { user, accessToken, refreshToken } = await authService.login({
    ...req.body,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  res.cookie('access_token', accessToken, cookieOptions(15 * 60 * 1000));
  res.cookie('refresh_token', refreshToken, { ...cookieOptions(7 * 24 * 60 * 60 * 1000), path: '/api/auth/refresh' });

  res.json({ success: true, data: { user, accessToken } });
};

export const refresh = async (req: Request, res: Response) => {
  const token = req.cookies?.refresh_token;
  if (!token) return res.status(401).json({ success: false, error: { code: 'NO_TOKEN', message: 'No refresh token' } });

  const { accessToken, refreshToken } = await authService.refreshTokens(token);

  res.cookie('access_token', accessToken, cookieOptions(15 * 60 * 1000));
  res.cookie('refresh_token', refreshToken, { ...cookieOptions(7 * 24 * 60 * 60 * 1000), path: '/api/auth/refresh' });

  res.json({ success: true });
};

export const logout = async (req: Request & { user?: { id: string } }, res: Response) => {
  if (req.user?.id) await authService.logout(req.user.id);
  res.clearCookie('access_token');
  res.clearCookie('refresh_token');
  res.json({ success: true });
};
