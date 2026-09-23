import { Router, Response, NextFunction } from 'express';
import { authenticate, authorize, verifyAccountStatus, AuthRequest } from '../middleware/auth';
import { LeaveBalanceService } from '../services/leaveBalance.service';
import { AppError } from '../middleware/errorHandler';
import pool from '../database/pool';
import { RowDataPacket } from 'mysql2';

export const leaveBalanceRouter = Router();
leaveBalanceRouter.use(authenticate, verifyAccountStatus);

// Own balances.
leaveBalanceRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const year = parseInt(req.query.year as string) || new Date().getFullYear();
    const balances = await LeaveBalanceService.getAllBalances(req.user!.userId, year);
    res.json(balances);
  } catch (error) { next(error); }
});

/**
 * Another employee's balances.
 *
 * Admins may read anyone. Managers are restricted to their own direct reports —
 * a role check alone would let any manager read any employee's data.
 */
leaveBalanceRouter.get(
  '/:employeeId',
  authorize('Manager', 'Admin'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { employeeId } = req.params;
      const requester = req.user!;

      if (requester.role === 'Manager' && employeeId !== requester.userId) {
        const [rows] = await pool.execute<RowDataPacket[]>(
          'SELECT id FROM employees WHERE id = ? AND manager_id = ?',
          [employeeId, requester.userId]
        );
        if (rows.length === 0) {
          throw new AppError(403, 'FORBIDDEN', 'You can only view leave balances for your own team members');
        }
      }

      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      const balances = await LeaveBalanceService.getAllBalances(employeeId, year);
      res.json(balances);
    } catch (error) { next(error); }
  }
);
