import { Router, Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service';
import { AuditService } from '../services/audit.service';
import { authenticate, AuthRequest } from '../middleware/auth';
import { loginLimiter } from '../middleware/rateLimiter';

export const authRouter = Router();

authRouter.post('/login', loginLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Email and password are required' });
      return;
    }
    const result = await AuthService.login(email, password, req.ip);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// JWTs are stateless, so this records the event for the audit trail rather than
// invalidating the token server-side. The client discards it.
authRouter.post('/logout', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await AuditService.log(
      req.user!.userId,
      'LOGOUT',
      'employee',
      req.user!.userId,
      'User logged out',
      req.ip
    );
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    next(error);
  }
});

authRouter.get('/me', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await AuthService.getCurrentUser(req.user!.userId);
    if (!user) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'User not found' });
      return;
    }
    if (!user.is_active) {
      res.status(401).json({ error: 'ACCOUNT_DEACTIVATED', message: 'Your account has been deactivated' });
      return;
    }
    res.json(user);
  } catch (error) {
    next(error);
  }
});

authRouter.post('/change-password', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
      res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Current password and new password are required' });
      return;
    }
    await AuthService.changePassword(req.user!.userId, current_password, new_password, req.ip);
    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    next(error);
  }
});
