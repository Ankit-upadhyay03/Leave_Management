import { Router, Response, NextFunction } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import pool from '../database/pool';
import { RowDataPacket } from 'mysql2';

export const holidayRouter = Router();
holidayRouter.use(authenticate);

/**
 * Holidays for a year, readable by any authenticated user.
 *
 * Dates are formatted in SQL rather than returned as Date objects: the mysql2 driver
 * converts a DATE to a local-time Date, and a later UTC serialisation shifts the
 * calendar day for non-UTC timezones.
 */
holidayRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = parseInt(req.query.year as string);
    const year = Number.isFinite(parsed) && parsed >= 1970 && parsed <= 2100 ? parsed : new Date().getFullYear();

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT id, name, DATE_FORMAT(holiday_date, "%Y-%m-%d") as holiday_date, description, year
       FROM holidays WHERE year = ? ORDER BY holiday_date ASC`,
      [year]
    );
    res.json(rows);
  } catch (error) { next(error); }
});
