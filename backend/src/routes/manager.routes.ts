import { Router, Response, NextFunction } from 'express';
import { authenticate, authorize, verifyAccountStatus, AuthRequest } from '../middleware/auth';
import { LeaveRequestService } from '../services/leaveRequest.service';
import pool from '../database/pool';
import { RowDataPacket } from 'mysql2';

export const managerRouter = Router();
managerRouter.use(authenticate, verifyAccountStatus, authorize('Manager', 'Admin'));

/** Positive integer page number; anything else falls back to page 1. */
function safePage(value: unknown): number {
  const parsed = parseInt(value as string);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

managerRouter.get('/pending-requests', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT lr.id, lr.employee_id, lr.leave_type_id,
              DATE_FORMAT(lr.from_date, "%Y-%m-%d") as from_date,
              DATE_FORMAT(lr.to_date, "%Y-%m-%d") as to_date,
              lr.is_half_day, lr.days_count, lr.reason, lr.status, lr.submitted_at,
              lt.name as leave_type_name, e.name as employee_name, e.employee_code,
              lb.balance as current_balance
       FROM leave_requests lr
       JOIN leave_types lt ON lr.leave_type_id = lt.id
       JOIN employees e ON lr.employee_id = e.id
       LEFT JOIN leave_balances lb ON lb.employee_id = lr.employee_id
         AND lb.leave_type_id = lr.leave_type_id
         AND lb.year = YEAR(lr.from_date)
       WHERE e.manager_id = ? AND lr.status = 'Pending'
       ORDER BY lr.submitted_at ASC`,
      [req.user!.userId]
    );
    res.json(rows);
  } catch (error) { next(error); }
});

managerRouter.patch('/requests/:id/approve', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const request = await LeaveRequestService.approve(req.params.id, req.user!.userId);
    res.json(request);
  } catch (error) { next(error); }
});

managerRouter.patch('/requests/:id/reject', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { remarks } = req.body;
    const request = await LeaveRequestService.reject(req.params.id, req.user!.userId, remarks);
    res.json(request);
  } catch (error) { next(error); }
});

managerRouter.get('/team-calendar', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const now = new Date();
    const month = parseInt(req.query.month as string) || now.getMonth() + 1;
    const year = parseInt(req.query.year as string) || now.getFullYear();

    if (month < 1 || month > 12) {
      res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Month must be between 1 and 12' });
      return;
    }

    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const from = (req.query.from_date as string) || monthStart;
    const to = (req.query.to_date as string) || monthEnd;

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT lr.id, lr.employee_id,
              DATE_FORMAT(lr.from_date, "%Y-%m-%d") as from_date,
              DATE_FORMAT(lr.to_date, "%Y-%m-%d") as to_date,
              lr.days_count, lr.is_half_day, lr.reason,
              e.name as employee_name, e.employee_code, e.designation,
              lt.name as leave_type_name
       FROM leave_requests lr
       JOIN employees e ON lr.employee_id = e.id
       JOIN leave_types lt ON lr.leave_type_id = lt.id
       WHERE e.manager_id = ? AND lr.status = 'Approved'
         AND lr.from_date <= ? AND lr.to_date >= ?
       ORDER BY lr.from_date ASC`,
      [req.user!.userId, to, from]
    );
    res.json(rows);
  } catch (error) { next(error); }
});

managerRouter.get('/team-history', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const whereClauses = ['e.manager_id = ?'];
    const params: any[] = [req.user!.userId];

    if (req.query.employee_id) { whereClauses.push('lr.employee_id = ?'); params.push(req.query.employee_id); }
    if (req.query.status) { whereClauses.push('lr.status = ?'); params.push(req.query.status); }
    if (req.query.from_date) { whereClauses.push('lr.from_date >= ?'); params.push(req.query.from_date); }
    if (req.query.to_date) { whereClauses.push('lr.to_date <= ?'); params.push(req.query.to_date); }

    const whereClause = whereClauses.join(' AND ');
    const page = safePage(req.query.page);
    const offset = (page - 1) * 20;

    const [countRows] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM leave_requests lr JOIN employees e ON lr.employee_id = e.id WHERE ${whereClause}`,
      params
    );
    const total = parseInt(countRows[0].total);

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT lr.id, lr.employee_id, lr.leave_type_id,
              DATE_FORMAT(lr.from_date, "%Y-%m-%d") as from_date,
              DATE_FORMAT(lr.to_date, "%Y-%m-%d") as to_date,
              lr.days_count, lr.reason, lr.status, lr.manager_remarks, lr.submitted_at,
              lt.name as leave_type_name, e.name as employee_name, e.employee_code
       FROM leave_requests lr
       JOIN leave_types lt ON lr.leave_type_id = lt.id
       JOIN employees e ON lr.employee_id = e.id
       WHERE ${whereClause}
       ORDER BY lr.submitted_at DESC
       LIMIT 20 OFFSET ${offset}`,
      params
    );

    const [balances] = await pool.execute<RowDataPacket[]>(
      `SELECT lb.employee_id, lb.leave_type_id, lb.balance, lb.year,
              e.name as employee_name, lt.name as leave_type_name, lt.yearly_allocation
       FROM leave_balances lb
       JOIN employees e ON lb.employee_id = e.id
       JOIN leave_types lt ON lb.leave_type_id = lt.id
       WHERE e.manager_id = ? AND lb.year = ? AND lt.is_active = true
       ORDER BY e.name, lt.name`,
      [req.user!.userId, new Date().getFullYear()]
    );

    res.json({ requests: rows, balances, total, page, totalPages: Math.max(1, Math.ceil(total / 20)) });
  } catch (error) { next(error); }
});

// Team roster, so the frontend can populate the employee filter.
managerRouter.get('/team', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT id, employee_code, name, email, designation, is_active
       FROM employees WHERE manager_id = ? ORDER BY name`,
      [req.user!.userId]
    );
    res.json(rows);
  } catch (error) { next(error); }
});
