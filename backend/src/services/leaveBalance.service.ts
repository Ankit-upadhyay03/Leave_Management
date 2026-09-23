import { v4 as uuidv4 } from 'uuid';
import pool from '../database/pool';
import { AppError } from '../middleware/errorHandler';
import { RowDataPacket, ResultSetHeader, PoolConnection } from 'mysql2/promise';

/** Anything that can run a query: the pool or a transaction connection. */
type Executor = Pick<PoolConnection, 'execute'> | typeof pool;

export class LeaveBalanceService {
  static async getBalance(employeeId: string, leaveTypeId: string, year?: number): Promise<any | null> {
    const targetYear = year ?? new Date().getFullYear();
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT * FROM leave_balances WHERE employee_id = ? AND leave_type_id = ? AND year = ?',
      [employeeId, leaveTypeId, targetYear]
    );
    return rows[0] || null;
  }

  /**
   * Read a balance row with a row-level write lock. Must be called inside a transaction.
   * Prevents concurrent approvals from both passing the sufficiency check.
   */
  static async getBalanceForUpdate(
    conn: PoolConnection,
    employeeId: string,
    leaveTypeId: string,
    year: number
  ): Promise<any | null> {
    const [rows] = await conn.execute<RowDataPacket[]>(
      'SELECT * FROM leave_balances WHERE employee_id = ? AND leave_type_id = ? AND year = ? FOR UPDATE',
      [employeeId, leaveTypeId, year]
    );
    return rows[0] || null;
  }

  static async getAllBalances(employeeId: string, year?: number): Promise<any[]> {
    const targetYear = year ?? new Date().getFullYear();
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT lb.*, lt.name as leave_type_name, lt.yearly_allocation
       FROM leave_balances lb
       JOIN leave_types lt ON lb.leave_type_id = lt.id
       WHERE lb.employee_id = ? AND lb.year = ? AND lt.is_active = true`,
      [employeeId, targetYear]
    );
    return rows;
  }

  /**
   * Deduct days from a specific year's balance.
   * Pass a transaction connection to make this atomic with the caller's other writes.
   */
  static async deductBalance(
    employeeId: string,
    leaveTypeId: string,
    days: number,
    year: number,
    conn?: PoolConnection
  ): Promise<void> {
    const executor: Executor = conn ?? pool;

    const [rows] = await executor.execute<RowDataPacket[]>(
      conn
        ? 'SELECT balance FROM leave_balances WHERE employee_id = ? AND leave_type_id = ? AND year = ? FOR UPDATE'
        : 'SELECT balance FROM leave_balances WHERE employee_id = ? AND leave_type_id = ? AND year = ?',
      [employeeId, leaveTypeId, year]
    );

    if (rows.length === 0) {
      throw new AppError(
        409,
        'NO_BALANCE_RECORD',
        `No leave balance allocated for year ${year}. Please contact the administrator.`
      );
    }
    if (parseFloat(rows[0].balance) < days) {
      throw new AppError(409, 'INSUFFICIENT_BALANCE', 'Insufficient leave balance for this leave type');
    }

    // Guard in the WHERE clause too, so the balance can never go negative even under a race.
    const [result] = await executor.execute<ResultSetHeader>(
      `UPDATE leave_balances SET balance = balance - ?
       WHERE employee_id = ? AND leave_type_id = ? AND year = ? AND balance >= ?`,
      [days, employeeId, leaveTypeId, year, days]
    );

    if (result.affectedRows !== 1) {
      throw new AppError(409, 'INSUFFICIENT_BALANCE', 'Balance changed during processing. Please retry.');
    }
  }

  /**
   * Restore days to a specific year's balance, capped at the leave type's yearly allocation
   * so repeated restores can never inflate a balance beyond its entitlement.
   */
  static async restoreBalance(
    employeeId: string,
    leaveTypeId: string,
    days: number,
    year: number,
    conn?: PoolConnection
  ): Promise<void> {
    const executor: Executor = conn ?? pool;

    const [result] = await executor.execute<ResultSetHeader>(
      `UPDATE leave_balances lb
       JOIN leave_types lt ON lb.leave_type_id = lt.id
       SET lb.balance = LEAST(lb.balance + ?, lt.yearly_allocation)
       WHERE lb.employee_id = ? AND lb.leave_type_id = ? AND lb.year = ?`,
      [days, employeeId, leaveTypeId, year]
    );

    if (result.affectedRows !== 1) {
      throw new AppError(
        409,
        'NO_BALANCE_RECORD',
        `No leave balance record found for year ${year} to restore against.`
      );
    }
  }

  /**
   * Allocate/reset balances for every active employee for the given year.
   * Existing rows are left untouched so a re-run never wipes a mid-year balance.
   */
  static async allocateYearlyBalances(year?: number): Promise<{ created: number; skipped: number }> {
    const targetYear = year ?? new Date().getFullYear();
    const [employees] = await pool.execute<RowDataPacket[]>('SELECT id FROM employees WHERE is_active = true');
    const [leaveTypes] = await pool.execute<RowDataPacket[]>(
      'SELECT id, yearly_allocation FROM leave_types WHERE is_active = true'
    );

    let created = 0;
    let skipped = 0;

    for (const emp of employees) {
      for (const lt of leaveTypes) {
        const [result] = await pool.execute<ResultSetHeader>(
          `INSERT INTO leave_balances (id, employee_id, leave_type_id, balance, year)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE id = id`,
          [uuidv4(), emp.id, lt.id, lt.yearly_allocation, targetYear]
        );
        if (result.affectedRows === 1) created++;
        else skipped++;
      }
    }

    return { created, skipped };
  }

  /** Overwrite balances for a year with the configured allocation (explicit admin reset). */
  static async resetYearlyBalances(year?: number): Promise<number> {
    const targetYear = year ?? new Date().getFullYear();
    const [employees] = await pool.execute<RowDataPacket[]>('SELECT id FROM employees WHERE is_active = true');
    const [leaveTypes] = await pool.execute<RowDataPacket[]>(
      'SELECT id, yearly_allocation FROM leave_types WHERE is_active = true'
    );

    let count = 0;
    for (const emp of employees) {
      for (const lt of leaveTypes) {
        await pool.execute(
          `INSERT INTO leave_balances (id, employee_id, leave_type_id, balance, year)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE balance = VALUES(balance), updated_at = NOW()`,
          [uuidv4(), emp.id, lt.id, lt.yearly_allocation, targetYear]
        );
        count++;
      }
    }
    return count;
  }

  static async allocateProratedBalance(employeeId: string, startMonth: number, year?: number): Promise<void> {
    const targetYear = year ?? new Date().getFullYear();
    const remainingMonths = 12 - startMonth + 1;
    const prorationFactor = remainingMonths / 12;

    const [leaveTypes] = await pool.execute<RowDataPacket[]>(
      'SELECT id, yearly_allocation FROM leave_types WHERE is_active = true'
    );

    for (const lt of leaveTypes) {
      const proratedBalance = Math.round(parseFloat(lt.yearly_allocation) * prorationFactor * 2) / 2;
      await pool.execute(
        `INSERT INTO leave_balances (id, employee_id, leave_type_id, balance, year)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE balance = VALUES(balance), updated_at = NOW()`,
        [uuidv4(), employeeId, lt.id, proratedBalance, targetYear]
      );
    }
  }

  static async hasSufficientBalance(
    employeeId: string,
    leaveTypeId: string,
    days: number,
    year?: number
  ): Promise<boolean> {
    const balance = await LeaveBalanceService.getBalance(employeeId, leaveTypeId, year);
    return balance !== null && parseFloat(balance.balance) >= days;
  }
}
