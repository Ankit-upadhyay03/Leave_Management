import { v4 as uuidv4 } from 'uuid';
import pool from '../database/pool';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { EmailService, LeaveDetails } from './email.service';

/** Everything the approval emails need, resolved in one query. */
interface RequestContext {
  request_id: string;
  employee_id: string;
  employee_name: string;
  employee_email: string;
  employee_code: string;
  employee_role: string;
  designation: string | null;
  department_name: string | null;
  manager_id: string | null;
  manager_name: string | null;
  manager_email: string | null;
  leave_type_name: string;
  from_date: string;
  to_date: string;
  days_count: string;
  reason: string;
  is_half_day: number;
  status: string;
  manager_remarks: string | null;
}

export class NotificationService {
  private static async insert(recipientId: string, title: string, message: string): Promise<void> {
    await pool.execute(
      'INSERT INTO notifications (id, recipient_id, title, message) VALUES (?, ?, ?, ?)',
      [uuidv4(), recipientId, title, message]
    );
  }

  /**
   * Join the request to the employee, their department, and their reporting manager.
   * Dates are formatted in SQL to avoid the driver's UTC conversion shifting a day.
   */
  private static async loadContext(requestId: string): Promise<RequestContext | null> {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT lr.id as request_id, lr.employee_id,
              DATE_FORMAT(lr.from_date, "%Y-%m-%d") as from_date,
              DATE_FORMAT(lr.to_date, "%Y-%m-%d") as to_date,
              lr.days_count, lr.reason, lr.is_half_day, lr.status, lr.manager_remarks,
              e.name as employee_name, e.email as employee_email,
              e.employee_code, e.role as employee_role, e.designation,
              d.name as department_name,
              e.manager_id, m.name as manager_name, m.email as manager_email,
              lt.name as leave_type_name
       FROM leave_requests lr
       JOIN employees e ON lr.employee_id = e.id
       JOIN leave_types lt ON lr.leave_type_id = lt.id
       LEFT JOIN departments d ON e.department_id = d.id
       LEFT JOIN employees m ON e.manager_id = m.id
       WHERE lr.id = ?`,
      [requestId]
    );
    return (rows[0] as RequestContext) || null;
  }

  private static toLeaveDetails(ctx: RequestContext): LeaveDetails {
    return {
      leaveType: ctx.leave_type_name,
      fromDate: ctx.from_date,
      toDate: ctx.to_date,
      days: parseFloat(ctx.days_count),
      reason: ctx.reason,
      isHalfDay: !!ctx.is_half_day,
    };
  }

  /**
   * A new request needs approving: notify the requester's reporting manager.
   *
   * The email template differs by who is asking. An Employee's request goes to their
   * manager; a Manager's own request goes up to their approver (typically an Admin)
   * and identifies them by designation rather than department.
   */
  static async notifyApproverOfNewRequest(requestId: string): Promise<void> {
    const ctx = await NotificationService.loadContext(requestId);
    if (!ctx) return;

    // Nobody to route to — surfaced in logs so an unassigned reportee is visible.
    if (!ctx.manager_id || !ctx.manager_email) {
      console.warn(
        `Leave request ${requestId} from ${ctx.employee_name} (${ctx.employee_code}) has no reporting manager assigned; no approval email sent.`
      );
      return;
    }

    const leave = NotificationService.toLeaveDetails(ctx);
    const dateRange = `${ctx.from_date} to ${ctx.to_date}`;

    await NotificationService.insert(
      ctx.manager_id,
      'New Leave Request',
      `${ctx.employee_name} (${ctx.employee_code}) has submitted a ${ctx.leave_type_name} request from ${dateRange} (${leave.days} day(s)). Please review and approve or reject.`
    );

    if (ctx.employee_role === 'Manager' || ctx.employee_role === 'Admin') {
      // Upward request: identify by designation, falling back to department.
      const descriptor = ctx.designation
        ? `${ctx.designation}${ctx.department_name ? ` — ${ctx.department_name}` : ''}`
        : ctx.department_name
        ? `${ctx.department_name} department`
        : 'the organisation';

      await EmailService.sendLeaveRequestToApprover({
        to: ctx.manager_email,
        approverName: ctx.manager_name || 'Approver',
        managerName: ctx.employee_name,
        employeeCode: ctx.employee_code || '—',
        designationOrDepartment: descriptor,
        requestId,
        leave,
      });
    } else {
      await EmailService.sendLeaveRequestToManager({
        to: ctx.manager_email,
        managerName: ctx.manager_name || 'Manager',
        employeeName: ctx.employee_name,
        employeeCode: ctx.employee_code || '—',
        department: ctx.department_name || 'your',
        requestId,
        leave,
      });
    }
  }

  /** Approved or rejected: notify the requester, naming the person who decided. */
  static async notifyEmployeeOfDecision(requestId: string, deciderId: string): Promise<void> {
    const ctx = await NotificationService.loadContext(requestId);
    if (!ctx) return;

    const [deciderRows] = await pool.execute<RowDataPacket[]>('SELECT name FROM employees WHERE id = ?', [deciderId]);
    const deciderName = deciderRows[0]?.name || 'Your reporting manager';

    const days = parseFloat(ctx.days_count);
    const dateRange = `${ctx.from_date} to ${ctx.to_date}`;

    if (ctx.status === 'Approved') {
      await NotificationService.insert(
        ctx.employee_id,
        'Leave Request Approved',
        `Your ${ctx.leave_type_name} request from ${dateRange} (${days} day(s)) has been approved by ${deciderName}. Your leave balance has been updated.`
      );
      await EmailService.sendLeaveApprovalEmail({
        to: ctx.employee_email,
        employeeName: ctx.employee_name,
        approvedBy: deciderName,
        leaveType: ctx.leave_type_name,
        fromDate: ctx.from_date,
        toDate: ctx.to_date,
        days,
      });
      return;
    }

    if (ctx.status === 'Rejected') {
      const remarks = ctx.manager_remarks || 'No remarks provided';
      await NotificationService.insert(
        ctx.employee_id,
        'Leave Request Rejected',
        `Your ${ctx.leave_type_name} request from ${dateRange} was not approved by ${deciderName}. Remarks: ${remarks}`
      );
      await EmailService.sendLeaveRejectionEmail({
        to: ctx.employee_email,
        employeeName: ctx.employee_name,
        rejectedBy: deciderName,
        leaveType: ctx.leave_type_name,
        fromDate: ctx.from_date,
        toDate: ctx.to_date,
        days,
        reason: remarks,
      });
    }
  }

  /** An admin revoked an already-approved leave; balance has been restored. */
  static async notifyLeaveCancelledByAdmin(requestId: string): Promise<void> {
    const ctx = await NotificationService.loadContext(requestId);
    if (!ctx) return;

    const days = parseFloat(ctx.days_count);
    await NotificationService.insert(
      ctx.employee_id,
      'Approved Leave Cancelled',
      `Your approved ${ctx.leave_type_name} from ${ctx.from_date} to ${ctx.to_date} has been cancelled by the administrator. ${days} day(s) restored to your balance.`
    );
    await EmailService.sendLeaveCancelledByAdminEmail({
      to: ctx.employee_email,
      employeeName: ctx.employee_name,
      leaveType: ctx.leave_type_name,
      fromDate: ctx.from_date,
      toDate: ctx.to_date,
      days,
    });
  }

  /** A leave type was discontinued, so pending requests against it were auto-rejected. */
  static async notifyLeaveTypeDeactivated(employeeId: string, leaveTypeName: string): Promise<void> {
    await NotificationService.insert(
      employeeId,
      'Leave Request Rejected',
      `Your pending request for "${leaveTypeName}" was rejected because this leave type has been discontinued. Please apply under a different leave type.`
    );
  }

  static async getNotifications(userId: string, unreadOnly = false): Promise<any[]> {
    const sql = unreadOnly
      ? 'SELECT * FROM notifications WHERE recipient_id = ? AND is_read = false ORDER BY created_at DESC LIMIT 50'
      : 'SELECT * FROM notifications WHERE recipient_id = ? ORDER BY created_at DESC LIMIT 50';
    const [rows] = await pool.execute<RowDataPacket[]>(sql, [userId]);
    return rows;
  }

  static async getUnreadCount(userId: string): Promise<number> {
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT COUNT(*) as count FROM notifications WHERE recipient_id = ? AND is_read = false',
      [userId]
    );
    return parseInt(rows[0].count);
  }

  /** Scoped by recipient so one user can never mark another user's notification read. */
  static async markAsRead(notificationId: string, userId: string): Promise<boolean> {
    const [result] = await pool.execute<ResultSetHeader>(
      'UPDATE notifications SET is_read = true WHERE id = ? AND recipient_id = ?',
      [notificationId, userId]
    );
    return result.affectedRows === 1;
  }

  static async markAllAsRead(userId: string): Promise<number> {
    const [result] = await pool.execute<ResultSetHeader>(
      'UPDATE notifications SET is_read = true WHERE recipient_id = ? AND is_read = false',
      [userId]
    );
    return result.affectedRows;
  }
}
