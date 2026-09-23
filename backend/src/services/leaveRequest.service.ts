import { v4 as uuidv4 } from 'uuid';
import pool from '../database/pool';
import { AppError } from '../middleware/errorHandler';
import { LeaveCalculationService } from './leaveCalculation.service';
import { LeaveBalanceService } from './leaveBalance.service';
import { NotificationService } from './notification.service';
import { AuditService } from './audit.service';
import { RowDataPacket, ResultSetHeader, PoolConnection } from 'mysql2/promise';

export interface LeaveRequestInput {
  employee_id: string;
  leave_type_id: string;
  from_date: string;
  to_date: string;
  is_half_day: boolean;
  reason: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class LeaveRequestService {
  /** The leave year a request belongs to, derived from its start date. */
  private static leaveYear(fromDate: string | Date): number {
    return LeaveCalculationService.parseDate(fromDate).getFullYear();
  }

  static async submit(input: LeaveRequestInput): Promise<any> {
    const { employee_id, leave_type_id, from_date, to_date, is_half_day, reason } = input;

    if (!leave_type_id) throw new AppError(400, 'VALIDATION_ERROR', 'Leave type is required');
    if (!from_date || !DATE_RE.test(from_date)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'From date is required in YYYY-MM-DD format');
    }
    if (!to_date || !DATE_RE.test(to_date)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'To date is required in YYYY-MM-DD format');
    }

    const fromDate = LeaveCalculationService.parseDate(from_date);
    const toDate = LeaveCalculationService.parseDate(to_date);

    if (fromDate > toDate) {
      throw new AppError(400, 'VALIDATION_ERROR', 'From date must be before or equal to To date');
    }

    // Server-side past-date guard. The client sets min={today}, but a direct API
    // call must not be able to book leave retroactively.
    const today = LeaveCalculationService.parseDate(new Date());
    if (fromDate < today) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Cannot apply for leave on a past date');
    }

    if (is_half_day && from_date !== to_date) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Half-day leave requires From date and To date to be the same');
    }
    if (!reason || reason.trim().length < 1 || reason.length > 500) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Reason must be between 1 and 500 characters');
    }
    if (fromDate.getFullYear() !== toDate.getFullYear()) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'Leave cannot span two calendar years. Please submit separate requests.'
      );
    }

    const [ltRows] = await pool.execute<RowDataPacket[]>(
      'SELECT id, is_active FROM leave_types WHERE id = ?',
      [leave_type_id]
    );
    if (ltRows.length === 0 || !ltRows[0].is_active) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid or inactive leave type');
    }

    const daysCount = await LeaveCalculationService.calculateLeaveDays(fromDate, toDate, is_half_day);
    if (daysCount <= 0) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'The selected range contains no working days (only weekends and/or holidays)'
      );
    }

    const year = fromDate.getFullYear();
    const conn = await pool.getConnection();
    let created: any;

    try {
      await conn.beginTransaction();

      // Lock the balance row so a concurrent submit/approve can't pass the same check.
      const balance = await LeaveBalanceService.getBalanceForUpdate(conn, employee_id, leave_type_id, year);
      if (!balance) {
        throw new AppError(
          409,
          'NO_BALANCE_RECORD',
          `No leave balance allocated for ${year}. Please contact the administrator.`
        );
      }
      if (parseFloat(balance.balance) < daysCount) {
        throw new AppError(
          409,
          'INSUFFICIENT_BALANCE',
          `Insufficient balance: ${daysCount} day(s) requested, ${balance.balance} available`
        );
      }

      // Overlap check inside the transaction, against the same snapshot.
      const [overlapRows] = await conn.execute<RowDataPacket[]>(
        `SELECT COUNT(*) as count FROM leave_requests
         WHERE employee_id = ? AND status IN ('Pending', 'Approved')
           AND from_date <= ? AND to_date >= ?`,
        [employee_id, to_date, from_date]
      );
      if (parseInt(overlapRows[0].count) > 0) {
        throw new AppError(
          409,
          'DATE_OVERLAP',
          'The requested dates overlap with an existing pending or approved request'
        );
      }

      const id = uuidv4();
      await conn.execute(
        `INSERT INTO leave_requests (id, employee_id, leave_type_id, from_date, to_date, is_half_day, days_count, reason, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pending')`,
        [id, employee_id, leave_type_id, from_date, to_date, is_half_day, daysCount, reason.trim()]
      );

      const [rows] = await conn.execute<RowDataPacket[]>(
        `SELECT id, employee_id, leave_type_id,
                DATE_FORMAT(from_date, "%Y-%m-%d") as from_date,
                DATE_FORMAT(to_date, "%Y-%m-%d") as to_date,
                is_half_day, days_count, reason, status, manager_remarks, submitted_at
         FROM leave_requests WHERE id = ?`,
        [id]
      );
      created = rows[0];

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    // Side effects run after the commit so a failed email can't roll back the request.
    // The service resolves the approver and picks the right template by requester role.
    await NotificationService.notifyApproverOfNewRequest(created.id);
    await AuditService.log(
      employee_id,
      'LEAVE_APPLIED',
      'leave_request',
      created.id,
      `Applied ${daysCount} day(s) from ${created.from_date} to ${created.to_date}`
    );

    return created;
  }

  static async cancel(requestId: string, userId: string): Promise<any> {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [rows] = await conn.execute<RowDataPacket[]>(
        'SELECT * FROM leave_requests WHERE id = ? FOR UPDATE',
        [requestId]
      );
      if (rows.length === 0) throw new AppError(404, 'NOT_FOUND', 'Leave request not found');

      const request = rows[0];
      if (request.employee_id !== userId) {
        throw new AppError(403, 'FORBIDDEN', 'You can only cancel your own requests');
      }
      if (request.status !== 'Pending') {
        throw new AppError(409, 'INVALID_STATE', `Cannot cancel a ${request.status} request`);
      }

      const [result] = await conn.execute<ResultSetHeader>(
        `UPDATE leave_requests SET status = 'Cancelled', updated_at = NOW()
         WHERE id = ? AND status = 'Pending'`,
        [requestId]
      );
      if (result.affectedRows !== 1) {
        throw new AppError(409, 'INVALID_STATE', 'Request state changed during processing. Please retry.');
      }

      const updated = await LeaveRequestService.fetchRequest(conn, requestId);
      await conn.commit();

      await AuditService.log(userId, 'LEAVE_CANCELLED', 'leave_request', requestId, 'Cancelled own pending request');
      return updated;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  static async approve(requestId: string, managerId: string): Promise<any> {
    const conn = await pool.getConnection();
    let updated: any;
    let employeeId: string;

    try {
      await conn.beginTransaction();

      // Lock the request row first, then the balance row: consistent order avoids deadlocks.
      const [rows] = await conn.execute<RowDataPacket[]>(
        `SELECT *, DATE_FORMAT(from_date, "%Y-%m-%d") as from_date_str FROM leave_requests WHERE id = ? FOR UPDATE`,
        [requestId]
      );
      if (rows.length === 0) throw new AppError(404, 'NOT_FOUND', 'Leave request not found');

      const request = rows[0];
      if (request.status !== 'Pending') {
        throw new AppError(409, 'INVALID_STATE', `Cannot approve a ${request.status} request`);
      }

      const [empRows] = await conn.execute<RowDataPacket[]>(
        'SELECT manager_id, is_active FROM employees WHERE id = ?',
        [request.employee_id]
      );
      if (empRows.length === 0) throw new AppError(404, 'NOT_FOUND', 'Employee not found');
      if (empRows[0].manager_id !== managerId) {
        throw new AppError(403, 'FORBIDDEN', 'This employee does not report to you');
      }
      if (!empRows[0].is_active) {
        throw new AppError(409, 'INVALID_STATE', 'Cannot approve leave for a deactivated employee');
      }

      // Deduct against the year the leave falls in, not whatever year it is today.
      const year = LeaveRequestService.leaveYear(request.from_date_str);
      await LeaveBalanceService.deductBalance(
        request.employee_id,
        request.leave_type_id,
        parseFloat(request.days_count),
        year,
        conn
      );

      const [result] = await conn.execute<ResultSetHeader>(
        `UPDATE leave_requests SET status = 'Approved', updated_at = NOW()
         WHERE id = ? AND status = 'Pending'`,
        [requestId]
      );
      if (result.affectedRows !== 1) {
        throw new AppError(409, 'INVALID_STATE', 'Request state changed during processing. Please retry.');
      }

      updated = await LeaveRequestService.fetchRequest(conn, requestId);
      employeeId = request.employee_id;

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    await NotificationService.notifyEmployeeOfDecision(requestId, managerId);
    await AuditService.log(
      managerId,
      'LEAVE_APPROVED',
      'leave_request',
      requestId,
      `Approved ${updated.days_count} day(s) for employee ${employeeId}`
    );

    return updated;
  }

  static async reject(requestId: string, managerId: string, remarks: string): Promise<any> {
    if (!remarks || remarks.trim().length < 1 || remarks.length > 500) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Remarks must be between 1 and 500 characters');
    }

    const conn = await pool.getConnection();
    let updated: any;
    let employeeId: string;

    try {
      await conn.beginTransaction();

      const [rows] = await conn.execute<RowDataPacket[]>(
        'SELECT * FROM leave_requests WHERE id = ? FOR UPDATE',
        [requestId]
      );
      if (rows.length === 0) throw new AppError(404, 'NOT_FOUND', 'Leave request not found');

      const request = rows[0];
      if (request.status !== 'Pending') {
        throw new AppError(409, 'INVALID_STATE', `Cannot reject a ${request.status} request`);
      }

      const [empRows] = await conn.execute<RowDataPacket[]>(
        'SELECT manager_id FROM employees WHERE id = ?',
        [request.employee_id]
      );
      if (empRows[0]?.manager_id !== managerId) {
        throw new AppError(403, 'FORBIDDEN', 'This employee does not report to you');
      }

      const [result] = await conn.execute<ResultSetHeader>(
        `UPDATE leave_requests SET status = 'Rejected', manager_remarks = ?, updated_at = NOW()
         WHERE id = ? AND status = 'Pending'`,
        [remarks.trim(), requestId]
      );
      if (result.affectedRows !== 1) {
        throw new AppError(409, 'INVALID_STATE', 'Request state changed during processing. Please retry.');
      }

      updated = await LeaveRequestService.fetchRequest(conn, requestId);
      employeeId = request.employee_id;

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    await NotificationService.notifyEmployeeOfDecision(requestId, managerId);
    await AuditService.log(
      managerId,
      'LEAVE_REJECTED',
      'leave_request',
      requestId,
      `Rejected leave for employee ${employeeId}. Reason: ${remarks.trim()}`
    );

    return updated;
  }

  static async adminCancelApproved(requestId: string, adminId: string): Promise<any> {
    const conn = await pool.getConnection();
    let updated: any;
    let employeeId: string;

    try {
      await conn.beginTransaction();

      const [rows] = await conn.execute<RowDataPacket[]>(
        `SELECT *, DATE_FORMAT(from_date, "%Y-%m-%d") as from_date_str FROM leave_requests WHERE id = ? FOR UPDATE`,
        [requestId]
      );
      if (rows.length === 0) throw new AppError(404, 'NOT_FOUND', 'Leave request not found');

      const request = rows[0];
      if (request.status !== 'Approved') {
        throw new AppError(
          409,
          'INVALID_STATE',
          `Cannot cancel a ${request.status} request. Only approved requests can be cancelled by admin.`
        );
      }

      const year = LeaveRequestService.leaveYear(request.from_date_str);
      await LeaveBalanceService.restoreBalance(
        request.employee_id,
        request.leave_type_id,
        parseFloat(request.days_count),
        year,
        conn
      );

      const [result] = await conn.execute<ResultSetHeader>(
        `UPDATE leave_requests SET status = 'Cancelled', updated_at = NOW()
         WHERE id = ? AND status = 'Approved'`,
        [requestId]
      );
      if (result.affectedRows !== 1) {
        throw new AppError(409, 'INVALID_STATE', 'Request state changed during processing. Please retry.');
      }

      updated = await LeaveRequestService.fetchRequest(conn, requestId);
      employeeId = request.employee_id;

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    await NotificationService.notifyLeaveCancelledByAdmin(requestId);
    await AuditService.log(
      adminId,
      'LEAVE_CANCELLED_BY_ADMIN',
      'leave_request',
      requestId,
      `Cancelled approved leave for employee ${employeeId}; ${updated.days_count} day(s) restored`
    );

    return updated;
  }

  static async hasOverlap(
    employeeId: string,
    fromDate: string,
    toDate: string,
    excludeRequestId?: string
  ): Promise<boolean> {
    let query = `SELECT COUNT(*) as count FROM leave_requests
      WHERE employee_id = ? AND status IN ('Pending', 'Approved') AND from_date <= ? AND to_date >= ?`;
    const params: any[] = [employeeId, toDate, fromDate];

    if (excludeRequestId) {
      query += ' AND id != ?';
      params.push(excludeRequestId);
    }

    const [rows] = await pool.execute<RowDataPacket[]>(query, params);
    return parseInt(rows[0].count) > 0;
  }

  static async getEmployeeRequests(
    employeeId: string,
    filters: any = {},
    page: number = 1
  ): Promise<{ requests: any[]; total: number; page: number; totalPages: number }> {
    const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
    const whereClauses = ['lr.employee_id = ?'];
    const params: any[] = [employeeId];

    if (filters.leave_type_id) { whereClauses.push('lr.leave_type_id = ?'); params.push(filters.leave_type_id); }
    if (filters.status) { whereClauses.push('lr.status = ?'); params.push(filters.status); }
    if (filters.from_date) { whereClauses.push('lr.from_date >= ?'); params.push(filters.from_date); }
    if (filters.to_date) { whereClauses.push('lr.to_date <= ?'); params.push(filters.to_date); }

    const whereClause = whereClauses.join(' AND ');
    const offset = (safePage - 1) * 20;

    const [countRows] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM leave_requests lr WHERE ${whereClause}`,
      params
    );
    const total = parseInt(countRows[0].total);

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT lr.id, lr.employee_id, lr.leave_type_id,
              DATE_FORMAT(lr.from_date, "%Y-%m-%d") as from_date,
              DATE_FORMAT(lr.to_date, "%Y-%m-%d") as to_date,
              lr.is_half_day, lr.days_count, lr.reason, lr.status, lr.manager_remarks,
              lr.submitted_at, lt.name as leave_type_name
       FROM leave_requests lr
       JOIN leave_types lt ON lr.leave_type_id = lt.id
       WHERE ${whereClause}
       ORDER BY lr.submitted_at DESC
       LIMIT 20 OFFSET ${offset}`,
      params
    );

    return { requests: rows, total, page: safePage, totalPages: Math.max(1, Math.ceil(total / 20)) };
  }

  /** Consistent request shape with dates as plain YYYY-MM-DD strings. */
  private static async fetchRequest(conn: PoolConnection, requestId: string): Promise<any> {
    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT id, employee_id, leave_type_id,
              DATE_FORMAT(from_date, "%Y-%m-%d") as from_date,
              DATE_FORMAT(to_date, "%Y-%m-%d") as to_date,
              is_half_day, days_count, reason, status, manager_remarks, submitted_at, updated_at
       FROM leave_requests WHERE id = ?`,
      [requestId]
    );
    return rows[0];
  }
}
