import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { JwtPayload, Role } from '../types';
import { AppError } from './errorHandler';
import { JWT_SECRET } from '../config';
import pool from '../database/pool';
import { RowDataPacket } from 'mysql2';

export interface AuthRequest extends Request {
  user?: JwtPayload;
}

export function authenticate(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new AppError(401, 'AUTH_FAILED', 'Authentication required'));
  }

  const token = authHeader.split(' ')[1];
  try {
    req.user = jwt.verify(token, JWT_SECRET) as JwtPayload;
    next();
  } catch (error) {
    next(new AppError(401, 'AUTH_FAILED', 'Invalid or expired token'));
  }
}

/**
 * Re-reads the account from the database on every request.
 *
 * A JWT stays valid until it expires, so without this a user who is deactivated or
 * demoted keeps their old access for up to the full token lifetime.
 */
export async function verifyAccountStatus(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next(new AppError(401, 'AUTH_FAILED', 'Authentication required'));

    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT role, is_active FROM employees WHERE id = ?',
      [req.user.userId]
    );

    if (rows.length === 0) {
      return next(new AppError(401, 'AUTH_FAILED', 'Account no longer exists'));
    }
    if (!rows[0].is_active) {
      return next(new AppError(401, 'ACCOUNT_DEACTIVATED', 'Your account has been deactivated'));
    }

    // Trust the database over the token for the role, so demotions apply immediately.
    req.user.role = rows[0].role as Role;
    next();
  } catch (error) {
    next(error);
  }
}

export function authorize(...roles: Role[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new AppError(401, 'AUTH_FAILED', 'Authentication required'));
    }
    if (!roles.includes(req.user.role)) {
      return next(new AppError(403, 'FORBIDDEN', 'Access denied'));
    }
    next();
  };
}
