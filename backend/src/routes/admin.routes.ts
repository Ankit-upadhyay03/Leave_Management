import { Router, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import XLSX from 'xlsx';
import { authenticate, authorize, verifyAccountStatus, AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { LeaveRequestService } from '../services/leaveRequest.service';
import { LeaveBalanceService } from '../services/leaveBalance.service';
import { LeaveCalculationService } from '../services/leaveCalculation.service';
import { AuthService } from '../services/auth.service';
import { AuditService } from '../services/audit.service';
import { NotificationService } from '../services/notification.service';
import { EmailService } from '../services/email.service';
import pool from '../database/pool';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

const ALLOWED_UPLOAD_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls
  'text/csv',
  'application/csv',
  'text/plain', // some browsers report .csv as text/plain
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, cb) {
    // Reject by extension and MIME so arbitrary binaries never reach the XLSX parser.
    const ext = (file.originalname.split('.').pop() || '').toLowerCase();
    if (!['xlsx', 'xls', 'csv'].includes(ext)) {
      return cb(new AppError(400, 'INVALID_FILE_TYPE', 'Only .xlsx, .xls and .csv files are accepted'));
    }
    if (!ALLOWED_UPLOAD_MIMES.has(file.mimetype)) {
      return cb(new AppError(400, 'INVALID_FILE_TYPE', `Unsupported file type: ${file.mimetype}`));
    }
    cb(null, true);
  },
});

export const adminRouter = Router();
adminRouter.use(authenticate, verifyAccountStatus, authorize('Admin'));

const VALID_ROLES = ['Employee', 'Manager', 'Admin'] as const;

function safePage(value: unknown): number {
  const parsed = parseInt(value as string);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/** employees.mobile is VARCHAR(20); anything longer must be rejected, not truncated. */
const MOBILE_MAX_LENGTH = 20;

/** Dial codes recognised for canonical formatting, longest first. */
const DIAL_CODES = [
  '880', '971', '977', '234', '254', '966', '968', '974',
  '27', '33', '34', '39', '44', '49', '55', '60', '61', '62', '63', '65', '66',
  '81', '82', '84', '86', '91', '92', '94',
  '1', '7',
].sort((a, b) => b.length - a.length);

/**
 * Normalise a mobile number to "+<dial code> <subscriber digits>" and validate it.
 *
 * A malformed value previously reached MySQL and surfaced as an opaque 500
 * ("Data too long for column 'mobile'"). The common cause was the UI re-prepending a
 * dial code onto a value that already contained one, so a doubled code is rejected
 * explicitly rather than relying on the digit-count limit alone.
 */
function normalizeMobile(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  const raw = String(value).trim();
  if (raw === '') return null;

  // More than one '+' means a dial code was applied twice.
  if ((raw.match(/\+/g) || []).length > 1) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Phone number contains more than one country code. Please enter the number without the country code.'
    );
  }
  if (raw.indexOf('+') > 0) {
    throw new AppError(400, 'VALIDATION_ERROR', "The '+' may only appear at the start of a phone number");
  }
  if (/[^0-9+\s()-]/.test(raw)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Phone number may only contain digits, spaces, +, -, and parentheses');
  }

  const hasPlus = raw.startsWith('+');
  const digits = raw.replace(/[^0-9]/g, '');

  if (digits.length === 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Phone number must contain digits');
  }
  if (digits.length < 6) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Phone number is too short');
  }
  // E.164 allows at most 15 digits including the country code.
  if (digits.length > 15) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      `Phone number has ${digits.length} digits, exceeding the maximum of 15. Check that the country code was not entered twice.`
    );
  }

  if (!hasPlus) {
    // A bare local number is stored as-is.
    if (digits.length > MOBILE_MAX_LENGTH) {
      throw new AppError(400, 'VALIDATION_ERROR', `Phone number must not exceed ${MOBILE_MAX_LENGTH} characters`);
    }
    return digits;
  }

  // The UI sends a canonical "+<code> <subscriber>" with the dial code already
  // separated by a space. When that explicit boundary is present, trust it: the
  // part after the space IS the subscriber number, even if it happens to start
  // with the same digits as the dial code (e.g. an Indian number beginning "91").
  // The earlier heuristic that sniffed for a repeated prefix produced false
  // positives on exactly those legitimate numbers.
  const spaceIdx = raw.indexOf(' ');
  if (spaceIdx > 0) {
    const codeDigits = raw.slice(0, spaceIdx).replace(/[^0-9]/g, '');
    const subscriber = raw.slice(spaceIdx + 1).replace(/[^0-9]/g, '');

    if (subscriber.length >= 6 && DIAL_CODES.includes(codeDigits)) {
      const candidate = `+${codeDigits} ${subscriber}`;
      if (candidate.length > MOBILE_MAX_LENGTH) {
        throw new AppError(400, 'VALIDATION_ERROR', `Phone number must not exceed ${MOBILE_MAX_LENGTH} characters`);
      }
      return candidate;
    }
  }

  // No explicit separator (e.g. a pasted "+919198765432"): fall back to splitting a
  // recognised dial code off the front for canonical formatting.
  for (const code of DIAL_CODES) {
    if (!digits.startsWith(code)) continue;

    const subscriber = digits.slice(code.length);
    if (subscriber.length < 6) break; // not a real split; fall through

    const candidate = `+${code} ${subscriber}`;
    if (candidate.length > MOBILE_MAX_LENGTH) {
      throw new AppError(400, 'VALIDATION_ERROR', `Phone number must not exceed ${MOBILE_MAX_LENGTH} characters`);
    }
    return candidate;
  }

  const fallback = `+${digits}`;
  if (fallback.length > MOBILE_MAX_LENGTH) {
    throw new AppError(400, 'VALIDATION_ERROR', `Phone number must not exceed ${MOBILE_MAX_LENGTH} characters`);
  }
  return fallback;
}

// ========================
// DEPARTMENT MANAGEMENT
// ========================

adminRouter.get('/departments', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT d.*, (SELECT COUNT(*) FROM employees WHERE department_id = d.id AND is_active = true) as employee_count
       FROM departments d ORDER BY d.name`
    );
    res.json(rows);
  } catch (error) { next(error); }
});

adminRouter.post('/departments', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name } = req.body;
    if (!name || !String(name).trim()) throw new AppError(400, 'VALIDATION_ERROR', 'Department name is required');
    if (String(name).length > 100) throw new AppError(400, 'VALIDATION_ERROR', 'Department name must not exceed 100 characters');

    const [existing] = await pool.execute<RowDataPacket[]>('SELECT id FROM departments WHERE LOWER(name) = LOWER(?)', [name]);
    if (existing.length > 0) throw new AppError(409, 'DUPLICATE_NAME', 'Department already exists');

    const id = uuidv4();
    await pool.execute('INSERT INTO departments (id, name) VALUES (?, ?)', [id, String(name).trim()]);
    await AuditService.log(req.user!.userId, 'DEPARTMENT_CREATED', 'department', id, `Department "${name}" created`, req.ip);

    const [result] = await pool.execute<RowDataPacket[]>('SELECT * FROM departments WHERE id = ?', [id]);
    res.status(201).json(result[0]);
  } catch (error) { next(error); }
});

adminRouter.put('/departments/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name } = req.body;
    if (!name || !String(name).trim()) throw new AppError(400, 'VALIDATION_ERROR', 'Department name is required');

    const [existing] = await pool.execute<RowDataPacket[]>(
      'SELECT id FROM departments WHERE LOWER(name) = LOWER(?) AND id != ?', [name, req.params.id]
    );
    if (existing.length > 0) throw new AppError(409, 'DUPLICATE_NAME', 'Department name already exists');

    const [result] = await pool.execute<ResultSetHeader>(
      'UPDATE departments SET name = ? WHERE id = ?', [String(name).trim(), req.params.id]
    );
    if (result.affectedRows === 0) throw new AppError(404, 'NOT_FOUND', 'Department not found');

    await AuditService.log(req.user!.userId, 'DEPARTMENT_UPDATED', 'department', req.params.id, `Renamed to "${name}"`, req.ip);
    const [rows] = await pool.execute<RowDataPacket[]>('SELECT * FROM departments WHERE id = ?', [req.params.id]);
    res.json(rows[0]);
  } catch (error) { next(error); }
});

// Soft-delete: departments are referenced by employees, so they are deactivated, not removed.
adminRouter.patch('/departments/:id/deactivate', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const [members] = await pool.execute<RowDataPacket[]>(
      'SELECT COUNT(*) as count FROM employees WHERE department_id = ? AND is_active = true', [req.params.id]
    );
    if (parseInt(members[0].count) > 0) {
      throw new AppError(409, 'DEPARTMENT_IN_USE',
        `Cannot deactivate: ${members[0].count} active employee(s) belong to this department. Reassign them first.`);
    }

    const [result] = await pool.execute<ResultSetHeader>('UPDATE departments SET is_active = false WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) throw new AppError(404, 'NOT_FOUND', 'Department not found');

    await AuditService.log(req.user!.userId, 'DEPARTMENT_DEACTIVATED', 'department', req.params.id, 'Department deactivated', req.ip);
    res.json({ message: 'Department deactivated' });
  } catch (error) { next(error); }
});

adminRouter.patch('/departments/:id/activate', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const [result] = await pool.execute<ResultSetHeader>('UPDATE departments SET is_active = true WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) throw new AppError(404, 'NOT_FOUND', 'Department not found');
    await AuditService.log(req.user!.userId, 'DEPARTMENT_ACTIVATED', 'department', req.params.id, 'Department activated', req.ip);
    res.json({ message: 'Department activated' });
  } catch (error) { next(error); }
});

// ========================
// USER MANAGEMENT
// ========================

adminRouter.get('/employees', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT e.id, e.employee_code, e.name, e.email, e.mobile, e.role, e.department_id, e.designation,
              e.manager_id, DATE_FORMAT(e.date_of_joining, "%Y-%m-%d") as date_of_joining,
              e.is_active, e.is_temp_password, e.created_at,
              d.name as department_name, m.name as manager_name
       FROM employees e
       LEFT JOIN departments d ON e.department_id = d.id
       LEFT JOIN employees m ON e.manager_id = m.id
       ORDER BY e.name`
    );
    res.json(rows);
  } catch (error) { next(error); }
});

adminRouter.get('/next-employee-code', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json({ next_code: await peekNextEmployeeCode() });
  } catch (error) { next(error); }
});

adminRouter.post('/employees', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, email, mobile, department_id, designation, role, manager_id, date_of_joining } = req.body;

    if (!name || !String(name).trim()) throw new AppError(400, 'VALIDATION_ERROR', 'Name is required');
    if (!email || !department_id || !role) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Email, department, and role are required');
    }
    if (!VALID_ROLES.includes(role)) {
      throw new AppError(400, 'VALIDATION_ERROR', `Role must be one of: ${VALID_ROLES.join(', ')}`);
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid email format');
    }

    const normalizedMobile = normalizeMobile(mobile);

    const [existing] = await pool.execute<RowDataPacket[]>('SELECT id FROM employees WHERE email = ?', [normalizedEmail]);
    if (existing.length > 0) throw new AppError(409, 'DUPLICATE_EMAIL', 'An employee with this email already exists');

    const [dept] = await pool.execute<RowDataPacket[]>('SELECT name FROM departments WHERE id = ?', [department_id]);
    if (dept.length === 0) throw new AppError(400, 'VALIDATION_ERROR', 'Selected department does not exist');

    if (manager_id) {
      const [mgr] = await pool.execute<RowDataPacket[]>(
        `SELECT id FROM employees WHERE id = ? AND is_active = true AND role IN ('Manager','Admin')`, [manager_id]
      );
      if (mgr.length === 0) throw new AppError(400, 'VALIDATION_ERROR', 'Selected reporting manager is not a valid active manager');
    }

    const tempPassword = AuthService.generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, parseInt(process.env.BCRYPT_ROUNDS || '10'));
    const id = uuidv4();

    // Retry on the UNIQUE(employee_code) collision two concurrent creates can cause.
    let employeeCode = '';
    let inserted = false;
    for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
      employeeCode = await peekNextEmployeeCode(attempt);
      try {
        await pool.execute(
          `INSERT INTO employees (id, employee_code, name, email, mobile, password_hash, role, department_id, designation, manager_id, date_of_joining, is_temp_password)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, true)`,
          [id, employeeCode, String(name).trim(), normalizedEmail, normalizedMobile, passwordHash, role,
           department_id, designation || null, manager_id || null, date_of_joining || null]
        );
        inserted = true;
      } catch (err: any) {
        if (err.code !== 'ER_DUP_ENTRY') throw err;
        if (String(err.message).includes('email')) {
          throw new AppError(409, 'DUPLICATE_EMAIL', 'An employee with this email already exists');
        }
        // Otherwise it was the employee_code; loop and take the next number.
      }
    }
    if (!inserted) {
      throw new AppError(500, 'CODE_GENERATION_FAILED', 'Could not allocate a unique employee code. Please retry.');
    }

    await LeaveBalanceService.allocateProratedBalance(id, new Date().getMonth() + 1);
    await AuditService.log(req.user!.userId, 'USER_CREATED', 'employee', id,
      `User "${name}" (${role}) created as ${employeeCode}`, req.ip);

    // Fire-and-forget: a mail failure must not undo a created account.
    EmailService.sendWelcomeEmail({
      to: normalizedEmail,
      name: String(name).trim(),
      employeeCode,
      tempPassword,
      role,
      designation: designation || undefined,
      department: dept[0].name || undefined,
    }).catch(err => console.error('Welcome email failed:', err));

    const [result] = await pool.execute<RowDataPacket[]>(
      `SELECT e.id, e.employee_code, e.name, e.email, e.mobile, e.role, e.department_id, e.designation,
              e.manager_id, e.is_active, d.name as department_name
       FROM employees e LEFT JOIN departments d ON e.department_id = d.id WHERE e.id = ?`, [id]
    );

    res.status(201).json({
      ...result[0],
      temp_password: tempPassword,
      message: `Account created. Employee ID: ${employeeCode}.`,
    });
  } catch (error) { next(error); }
});

adminRouter.put('/employees/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, email, mobile, department_id, designation, role, manager_id } = req.body;
    const targetId = req.params.id;

    const [targetRows] = await pool.execute<RowDataPacket[]>('SELECT role FROM employees WHERE id = ?', [targetId]);
    if (targetRows.length === 0) throw new AppError(404, 'NOT_FOUND', 'Employee not found');
    const currentRole = targetRows[0].role;

    if (role !== undefined) {
      if (!VALID_ROLES.includes(role)) {
        throw new AppError(400, 'VALIDATION_ERROR', `Role must be one of: ${VALID_ROLES.join(', ')}`);
      }
      // Don't let an admin demote themselves out of the console they're using.
      if (targetId === req.user!.userId && role !== 'Admin') {
        throw new AppError(403, 'FORBIDDEN', 'You cannot change your own role. Ask another administrator.');
      }
      // Never leave the system without an admin.
      if (currentRole === 'Admin' && role !== 'Admin') {
        const [admins] = await pool.execute<RowDataPacket[]>(
          `SELECT COUNT(*) as count FROM employees WHERE role = 'Admin' AND is_active = true AND id != ?`, [targetId]
        );
        if (parseInt(admins[0].count) === 0) {
          throw new AppError(409, 'LAST_ADMIN', 'Cannot demote the last active administrator');
        }
      }
      // Demoting a manager would orphan their reports.
      if (currentRole === 'Manager' && role === 'Employee') {
        const [reportees] = await pool.execute<RowDataPacket[]>(
          'SELECT COUNT(*) as count FROM employees WHERE manager_id = ? AND is_active = true', [targetId]
        );
        if (parseInt(reportees[0].count) > 0) {
          throw new AppError(409, 'HAS_REPORTEES',
            `Cannot demote to Employee: ${reportees[0].count} active reportee(s). Reassign them first.`);
        }
      }
    }

    let normalizedEmail: string | undefined;
    if (email !== undefined) {
      normalizedEmail = String(email).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid email format');
      }
      const [dupe] = await pool.execute<RowDataPacket[]>(
        'SELECT id FROM employees WHERE email = ? AND id != ?', [normalizedEmail, targetId]
      );
      if (dupe.length > 0) throw new AppError(409, 'DUPLICATE_EMAIL', 'Email already exists');
    }

    // Validated and length-capped before the UPDATE, so an over-long value returns
    // a clear 400 instead of surfacing a MySQL "Data too long" error as a 500.
    const normalizedMobile = mobile !== undefined ? normalizeMobile(mobile) : undefined;

    if (manager_id) {
      if (manager_id === targetId) {
        throw new AppError(400, 'VALIDATION_ERROR', 'An employee cannot report to themselves');
      }
      const [mgr] = await pool.execute<RowDataPacket[]>(
        'SELECT manager_id FROM employees WHERE id = ? AND is_active = true', [manager_id]
      );
      if (mgr.length === 0) throw new AppError(400, 'VALIDATION_ERROR', 'Selected manager is not active');
      // Reject a direct two-node cycle (A reports to B, B reports to A).
      if (mgr[0].manager_id === targetId) {
        throw new AppError(400, 'VALIDATION_ERROR', 'This would create a circular reporting relationship');
      }
    }

    // employee_code is intentionally not updatable: it is the stable identifier
    // referenced by audit logs and prior correspondence.
    const setClauses: string[] = ['updated_at = NOW()'];
    const params: any[] = [];
    if (name) { setClauses.push('name = ?'); params.push(String(name).trim()); }
    if (normalizedEmail) { setClauses.push('email = ?'); params.push(normalizedEmail); }
    if (normalizedMobile !== undefined) { setClauses.push('mobile = ?'); params.push(normalizedMobile); }
    if (department_id) { setClauses.push('department_id = ?'); params.push(department_id); }
    if (designation !== undefined) { setClauses.push('designation = ?'); params.push(designation || null); }
    if (role) { setClauses.push('role = ?'); params.push(role); }
    if (manager_id !== undefined) { setClauses.push('manager_id = ?'); params.push(manager_id || null); }

    params.push(targetId);
    await pool.execute(`UPDATE employees SET ${setClauses.join(', ')} WHERE id = ?`, params);

    const changes = role && role !== currentRole ? `Role changed ${currentRole} -> ${role}` : 'Profile updated';
    await AuditService.log(req.user!.userId, 'USER_UPDATED', 'employee', targetId, changes, req.ip);

    const [result] = await pool.execute<RowDataPacket[]>(
      `SELECT e.id, e.employee_code, e.name, e.email, e.mobile, e.role, e.department_id, e.designation,
              e.manager_id, e.is_active, d.name as department_name, m.name as manager_name
       FROM employees e
       LEFT JOIN departments d ON e.department_id = d.id
       LEFT JOIN employees m ON e.manager_id = m.id
       WHERE e.id = ?`, [targetId]
    );
    res.json(result[0]);
  } catch (error) { next(error); }
});

adminRouter.patch('/employees/:id/deactivate', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const targetId = req.params.id;

    if (targetId === req.user!.userId) {
      throw new AppError(403, 'FORBIDDEN', 'You cannot deactivate your own account');
    }

    const [target] = await pool.execute<RowDataPacket[]>('SELECT role FROM employees WHERE id = ?', [targetId]);
    if (target.length === 0) throw new AppError(404, 'NOT_FOUND', 'Employee not found');

    if (target[0].role === 'Admin') {
      const [admins] = await pool.execute<RowDataPacket[]>(
        `SELECT COUNT(*) as count FROM employees WHERE role = 'Admin' AND is_active = true AND id != ?`, [targetId]
      );
      if (parseInt(admins[0].count) === 0) {
        throw new AppError(409, 'LAST_ADMIN', 'Cannot deactivate the last active administrator');
      }
    }

    const [reportees] = await pool.execute<RowDataPacket[]>(
      'SELECT COUNT(*) as count FROM employees WHERE manager_id = ? AND is_active = true', [targetId]
    );
    if (parseInt(reportees[0].count) > 0) {
      throw new AppError(409, 'HAS_REPORTEES', 'Cannot deactivate: reassign reportees first');
    }

    // Deactivation must also clear the employee's open workflow, otherwise pending
    // requests sit unactionable and future approved leave stays on the team calendar.
    const conn = await pool.getConnection();
    let cancelled = 0;
    try {
      await conn.beginTransaction();
      // Stamp the disable time so the auto-purge job can measure how long the
      // account has been inactive.
      await conn.execute('UPDATE employees SET is_active = false, deactivated_at = NOW() WHERE id = ?', [targetId]);

      const [pending] = await conn.execute<ResultSetHeader>(
        `UPDATE leave_requests
         SET status = 'Cancelled', manager_remarks = 'Auto-cancelled: employee deactivated', updated_at = NOW()
         WHERE employee_id = ? AND status = 'Pending'`, [targetId]
      );
      cancelled = pending.affectedRows;
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    await AuditService.log(req.user!.userId, 'USER_DEACTIVATED', 'employee', targetId,
      `User deactivated; ${cancelled} pending request(s) auto-cancelled`, req.ip);
    res.json({ message: 'Employee deactivated successfully', pending_cancelled: cancelled });
  } catch (error) { next(error); }
});

adminRouter.patch('/employees/:id/activate', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // Clearing deactivated_at resets the purge clock for a returning employee.
    const [result] = await pool.execute<ResultSetHeader>('UPDATE employees SET is_active = true, deactivated_at = NULL WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) throw new AppError(404, 'NOT_FOUND', 'Employee not found');

    // A returning employee needs a balance row for the current year.
    await LeaveBalanceService.allocateProratedBalance(req.params.id, new Date().getMonth() + 1);
    await AuditService.log(req.user!.userId, 'USER_ACTIVATED', 'employee', req.params.id, 'User activated', req.ip);
    res.json({ message: 'Employee activated successfully' });
  } catch (error) { next(error); }
});

adminRouter.patch('/employees/:id/reset-password', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const tempPassword = await AuthService.resetPassword(req.params.id, req.user!.userId, req.ip);
    res.json({ message: 'Password reset successfully', temp_password: tempPassword });
  } catch (error) { next(error); }
});

/**
 * Permanently remove an employee.
 *
 * Deactivation is the normal path and preserves history. Deletion is only for
 * cleaning up accounts that carry no real workflow — a mistakenly created user.
 * We therefore refuse to delete anyone with leave-request history (that would
 * either violate the FK or destroy records the audit trail depends on) and reuse
 * the same self / last-admin / has-reportees guards as deactivation. The
 * incidental rows (balances, notifications, password history, login attempts)
 * are cleared in one transaction so the final DELETE cannot hit a FK error.
 */
adminRouter.delete('/employees/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const targetId = req.params.id;

    if (targetId === req.user!.userId) {
      throw new AppError(403, 'FORBIDDEN', 'You cannot delete your own account');
    }

    const [target] = await pool.execute<RowDataPacket[]>('SELECT role, email FROM employees WHERE id = ?', [targetId]);
    if (target.length === 0) throw new AppError(404, 'NOT_FOUND', 'Employee not found');

    if (target[0].role === 'Admin') {
      const [admins] = await pool.execute<RowDataPacket[]>(
        `SELECT COUNT(*) as count FROM employees WHERE role = 'Admin' AND id != ?`, [targetId]
      );
      if (parseInt(admins[0].count) === 0) {
        throw new AppError(409, 'LAST_ADMIN', 'Cannot delete the last administrator');
      }
    }

    // Anyone still managing others must be reassigned first, or their reportees
    // would be left pointing at a deleted manager.
    const [reportees] = await pool.execute<RowDataPacket[]>(
      'SELECT COUNT(*) as count FROM employees WHERE manager_id = ?', [targetId]
    );
    if (parseInt(reportees[0].count) > 0) {
      throw new AppError(409, 'HAS_REPORTEES', 'Cannot delete: this employee still manages others. Reassign their reportees first.');
    }

    // Real leave history must be retained. Steer the admin to deactivation instead.
    const [requests] = await pool.execute<RowDataPacket[]>(
      'SELECT COUNT(*) as count FROM leave_requests WHERE employee_id = ?', [targetId]
    );
    if (parseInt(requests[0].count) > 0) {
      throw new AppError(
        409,
        'HAS_HISTORY',
        'Cannot delete an employee with leave history. Disable the account instead to preserve records.'
      );
    }

    const email = target[0].email;
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute('DELETE FROM leave_balances WHERE employee_id = ?', [targetId]);
      await conn.execute('DELETE FROM notifications WHERE recipient_id = ?', [targetId]);
      await conn.execute('DELETE FROM password_history WHERE employee_id = ?', [targetId]);
      if (email) {
        await conn.execute('DELETE FROM login_attempts WHERE email = ?', [email]);
      }
      const [del] = await conn.execute<ResultSetHeader>('DELETE FROM employees WHERE id = ?', [targetId]);
      if (del.affectedRows === 0) throw new AppError(404, 'NOT_FOUND', 'Employee not found');
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    await AuditService.log(req.user!.userId, 'USER_DELETED', 'employee', targetId,
      `Employee permanently deleted (${email})`, req.ip);
    res.json({ message: 'Employee deleted permanently' });
  } catch (error) { next(error); }
});

// ========================
// LEAVE TYPE CONFIGURATION
// ========================

adminRouter.get('/leave-types', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const [rows] = await pool.execute<RowDataPacket[]>('SELECT * FROM leave_types ORDER BY name ASC');
    res.json(rows);
  } catch (error) { next(error); }
});

adminRouter.post('/leave-types', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, yearly_allocation } = req.body;
    const allocation = Number(yearly_allocation);

    if (!name || String(name).trim().length < 1 || String(name).length > 100) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Name is required (max 100 characters)');
    }
    if (!Number.isFinite(allocation) || allocation < 0.5 || allocation > 365) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Allocation must be a number between 0.5 and 365');
    }
    if ((allocation * 2) % 1 !== 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Allocation must be in increments of 0.5');
    }

    const [existing] = await pool.execute<RowDataPacket[]>('SELECT id FROM leave_types WHERE LOWER(name) = LOWER(?)', [name]);
    if (existing.length > 0) throw new AppError(409, 'DUPLICATE_NAME', 'Leave type already exists');

    const id = uuidv4();
    await pool.execute('INSERT INTO leave_types (id, name, yearly_allocation) VALUES (?, ?, ?)',
      [id, String(name).trim(), allocation]);
    await AuditService.log(req.user!.userId, 'LEAVE_TYPE_CREATED', 'leave_type', id,
      `Leave type "${name}" created with ${allocation} days`, req.ip);

    const [result] = await pool.execute<RowDataPacket[]>('SELECT * FROM leave_types WHERE id = ?', [id]);
    res.status(201).json(result[0]);
  } catch (error) { next(error); }
});

adminRouter.put('/leave-types/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, yearly_allocation } = req.body;

    if (name !== undefined && (!String(name).trim() || String(name).length > 100)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Name is required (max 100 characters)');
    }
    if (yearly_allocation !== undefined) {
      const allocation = Number(yearly_allocation);
      if (!Number.isFinite(allocation) || allocation < 0.5 || allocation > 365 || (allocation * 2) % 1 !== 0) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Allocation must be between 0.5 and 365 in increments of 0.5');
      }
    }
    if (name) {
      const [existing] = await pool.execute<RowDataPacket[]>(
        'SELECT id FROM leave_types WHERE LOWER(name) = LOWER(?) AND id != ?', [name, req.params.id]
      );
      if (existing.length > 0) throw new AppError(409, 'DUPLICATE_NAME', 'Leave type already exists');
    }

    const setClauses: string[] = ['updated_at = NOW()'];
    const params: any[] = [];
    if (name) { setClauses.push('name = ?'); params.push(String(name).trim()); }
    if (yearly_allocation !== undefined) { setClauses.push('yearly_allocation = ?'); params.push(Number(yearly_allocation)); }
    params.push(req.params.id);

    const [result] = await pool.execute<ResultSetHeader>(
      `UPDATE leave_types SET ${setClauses.join(', ')} WHERE id = ?`, params
    );
    if (result.affectedRows === 0) throw new AppError(404, 'NOT_FOUND', 'Leave type not found');

    await AuditService.log(req.user!.userId, 'LEAVE_TYPE_UPDATED', 'leave_type', req.params.id,
      'Leave type updated (existing balances unchanged)', req.ip);

    const [rows] = await pool.execute<RowDataPacket[]>('SELECT * FROM leave_types WHERE id = ?', [req.params.id]);
    res.json(rows[0]);
  } catch (error) { next(error); }
});

adminRouter.patch('/leave-types/:id/deactivate', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const [lt] = await pool.execute<RowDataPacket[]>('SELECT name FROM leave_types WHERE id = ?', [req.params.id]);
    if (lt.length === 0) throw new AppError(404, 'NOT_FOUND', 'Leave type not found');
    const leaveTypeName = lt[0].name;

    // Capture affected employees before the update so they can be notified afterwards.
    const [affected] = await pool.execute<RowDataPacket[]>(
      `SELECT DISTINCT employee_id FROM leave_requests WHERE leave_type_id = ? AND status = 'Pending'`,
      [req.params.id]
    );

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute('UPDATE leave_types SET is_active = false, updated_at = NOW() WHERE id = ?', [req.params.id]);
      await conn.execute(
        `UPDATE leave_requests
         SET status = 'Rejected', manager_remarks = 'Leave type discontinued by administrator', updated_at = NOW()
         WHERE leave_type_id = ? AND status = 'Pending'`, [req.params.id]
      );
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    // Previously these mass rejections happened silently.
    for (const row of affected) {
      await NotificationService.notifyLeaveTypeDeactivated(row.employee_id, leaveTypeName);
    }

    await AuditService.log(req.user!.userId, 'LEAVE_TYPE_DEACTIVATED', 'leave_type', req.params.id,
      `"${leaveTypeName}" deactivated; ${affected.length} pending request(s) rejected`, req.ip);

    res.json({ message: 'Leave type deactivated', pending_rejected: affected.length });
  } catch (error) { next(error); }
});

adminRouter.patch('/leave-types/:id/reactivate', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const [result] = await pool.execute<ResultSetHeader>(
      'UPDATE leave_types SET is_active = true, updated_at = NOW() WHERE id = ?', [req.params.id]
    );
    if (result.affectedRows === 0) throw new AppError(404, 'NOT_FOUND', 'Leave type not found');
    await AuditService.log(req.user!.userId, 'LEAVE_TYPE_REACTIVATED', 'leave_type', req.params.id, 'Leave type reactivated', req.ip);
    res.json({ message: 'Leave type reactivated' });
  } catch (error) { next(error); }
});

// ========================
// LEAVE BALANCE ADMINISTRATION
// ========================

/** Allocate balances for a year without touching existing rows. */
adminRouter.post('/leave-balances/allocate', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const year = parseInt(req.body?.year) || new Date().getFullYear();
    if (year < 2020 || year > 2100) throw new AppError(400, 'VALIDATION_ERROR', 'Year must be between 2020 and 2100');

    const { created, skipped } = await LeaveBalanceService.allocateYearlyBalances(year);
    await AuditService.log(req.user!.userId, 'BALANCES_ALLOCATED', 'leave_balance', null as any,
      `Allocated ${year}: ${created} created, ${skipped} already existed`, req.ip);

    res.json({ message: `Allocation complete for ${year}`, year, created, skipped });
  } catch (error) { next(error); }
});

/** Destructive: overwrite every balance for a year with the configured allocation. */
adminRouter.post('/leave-balances/reset', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const year = parseInt(req.body?.year) || new Date().getFullYear();
    if (req.body?.confirm !== true) {
      throw new AppError(400, 'CONFIRMATION_REQUIRED',
        'This overwrites all balances for the year and cannot be undone. Send { "confirm": true } to proceed.');
    }
    const count = await LeaveBalanceService.resetYearlyBalances(year);
    await AuditService.log(req.user!.userId, 'BALANCES_RESET', 'leave_balance', null as any,
      `Reset ${count} balance rows for ${year}`, req.ip);
    res.json({ message: `Reset ${count} balance rows for ${year}`, year, count });
  } catch (error) { next(error); }
});

// ========================
// HOLIDAY MANAGEMENT
// ========================

adminRouter.post('/holidays', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, holiday_date, description } = req.body;
    if (!name || !String(name).trim()) throw new AppError(400, 'VALIDATION_ERROR', 'Holiday name is required');
    if (String(name).length > 100) throw new AppError(400, 'VALIDATION_ERROR', 'Name must not exceed 100 characters');
    if (!holiday_date || !/^\d{4}-\d{2}-\d{2}$/.test(holiday_date)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Date is required in YYYY-MM-DD format');
    }
    if (description && String(description).length > 500) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Description must not exceed 500 characters');
    }

    const [existing] = await pool.execute<RowDataPacket[]>('SELECT id FROM holidays WHERE holiday_date = ?', [holiday_date]);
    if (existing.length > 0) throw new AppError(409, 'DUPLICATE_HOLIDAY_DATE', 'Holiday already exists for this date');

    const id = uuidv4();
    const year = parseInt(holiday_date.slice(0, 4));
    await pool.execute('INSERT INTO holidays (id, name, holiday_date, description, year) VALUES (?, ?, ?, ?, ?)',
      [id, String(name).trim(), holiday_date, description || '', year]);

    const recalculated = await recalculatePendingRequests(holiday_date);
    await AuditService.log(req.user!.userId, 'HOLIDAY_CREATED', 'holiday', id,
      `"${name}" on ${holiday_date}; ${recalculated} pending request(s) recalculated`, req.ip);

    const [result] = await pool.execute<RowDataPacket[]>(
      `SELECT id, name, DATE_FORMAT(holiday_date, "%Y-%m-%d") as holiday_date, description, year
       FROM holidays WHERE id = ?`, [id]
    );
    res.status(201).json(result[0]);
  } catch (error) { next(error); }
});

adminRouter.put('/holidays/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, holiday_date, description } = req.body;
    if (!name || !String(name).trim()) throw new AppError(400, 'VALIDATION_ERROR', 'Holiday name is required');
    if (!holiday_date || !/^\d{4}-\d{2}-\d{2}$/.test(holiday_date)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Date is required in YYYY-MM-DD format');
    }

    const [existing] = await pool.execute<RowDataPacket[]>(
      'SELECT id FROM holidays WHERE holiday_date = ? AND id != ?', [holiday_date, req.params.id]
    );
    if (existing.length > 0) throw new AppError(409, 'DUPLICATE_HOLIDAY_DATE', 'Holiday already exists for this date');

    const [oldH] = await pool.execute<RowDataPacket[]>(
      'SELECT DATE_FORMAT(holiday_date, "%Y-%m-%d") as holiday_date FROM holidays WHERE id = ?', [req.params.id]
    );
    if (oldH.length === 0) throw new AppError(404, 'NOT_FOUND', 'Holiday not found');

    const year = parseInt(holiday_date.slice(0, 4));
    await pool.execute(
      'UPDATE holidays SET name = ?, holiday_date = ?, description = ?, year = ?, updated_at = NOW() WHERE id = ?',
      [String(name).trim(), holiday_date, description || '', year, req.params.id]
    );

    // Both the vacated and the newly occupied date change day counts.
    await recalculatePendingRequests(oldH[0].holiday_date);
    await recalculatePendingRequests(holiday_date);
    await AuditService.log(req.user!.userId, 'HOLIDAY_UPDATED', 'holiday', req.params.id,
      `Moved ${oldH[0].holiday_date} -> ${holiday_date}`, req.ip);

    const [result] = await pool.execute<RowDataPacket[]>(
      `SELECT id, name, DATE_FORMAT(holiday_date, "%Y-%m-%d") as holiday_date, description, year
       FROM holidays WHERE id = ?`, [req.params.id]
    );
    res.json(result[0]);
  } catch (error) { next(error); }
});

adminRouter.delete('/holidays/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const [h] = await pool.execute<RowDataPacket[]>(
      `SELECT name, DATE_FORMAT(holiday_date, "%Y-%m-%d") as holiday_date FROM holidays WHERE id = ?`, [req.params.id]
    );
    if (h.length === 0) throw new AppError(404, 'NOT_FOUND', 'Holiday not found');

    await pool.execute('DELETE FROM holidays WHERE id = ?', [req.params.id]);
    const recalculated = await recalculatePendingRequests(h[0].holiday_date);

    await AuditService.log(req.user!.userId, 'HOLIDAY_DELETED', 'holiday', req.params.id,
      `"${h[0].name}" deleted; ${recalculated} pending request(s) recalculated`, req.ip);
    res.json({ message: 'Holiday deleted', requests_recalculated: recalculated });
  } catch (error) { next(error); }
});

adminRouter.post('/holidays/import', upload.single('file'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.file) throw new AppError(400, 'VALIDATION_ERROR', 'File is required');

    let rows: any[];
    try {
      const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!sheet) throw new Error('No sheet found');
      rows = XLSX.utils.sheet_to_json(sheet);
    } catch {
      throw new AppError(400, 'INVALID_FILE', 'Could not read the file. Ensure it is a valid Excel or CSV file.');
    }

    if (rows.length === 0) throw new AppError(400, 'VALIDATION_ERROR', 'File is empty or has no valid data');
    if (rows.length > 500) throw new AppError(400, 'VALIDATION_ERROR', 'Cannot import more than 500 holidays at once');

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];
    const seenInFile = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;

      const name = row['Holiday Name'] ?? row['Name'] ?? row['name'] ?? row['holiday_name'] ?? row['Holiday'];
      const dateVal = row['Date'] ?? row['date'] ?? row['holiday_date'] ?? row['Holiday Date'];
      const description = row['Description'] ?? row['description'] ?? row['desc'] ?? '';

      if (!name || !dateVal) {
        errors.push(`Row ${rowNum}: missing name or date`);
        skipped++;
        continue;
      }
      if (String(name).length > 100) {
        errors.push(`Row ${rowNum}: name exceeds 100 characters`);
        skipped++;
        continue;
      }

      let holidayDate: string;
      if (typeof dateVal === 'number') {
        const parsed = XLSX.SSF.parse_date_code(dateVal);
        if (!parsed) {
          errors.push(`Row ${rowNum}: unreadable date value`);
          skipped++;
          continue;
        }
        holidayDate = `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
      } else if (/^\d{4}-\d{2}-\d{2}/.test(String(dateVal))) {
        holidayDate = String(dateVal).slice(0, 10);
      } else {
        const d = new Date(String(dateVal));
        if (isNaN(d.getTime())) {
          errors.push(`Row ${rowNum}: invalid date "${dateVal}"`);
          skipped++;
          continue;
        }
        holidayDate = LeaveCalculationService.formatDate(d);
      }

      if (seenInFile.has(holidayDate)) {
        errors.push(`Row ${rowNum}: duplicate date ${holidayDate} within the file`);
        skipped++;
        continue;
      }

      const [existing] = await pool.execute<RowDataPacket[]>('SELECT id FROM holidays WHERE holiday_date = ?', [holidayDate]);
      if (existing.length > 0) {
        errors.push(`Row ${rowNum}: holiday already exists for ${holidayDate}`);
        skipped++;
        continue;
      }

      await pool.execute(
        'INSERT INTO holidays (id, name, holiday_date, description, year) VALUES (?, ?, ?, ?, ?)',
        [uuidv4(), String(name).trim(), holidayDate, String(description).trim().slice(0, 500), parseInt(holidayDate.slice(0, 4))]
      );
      seenInFile.add(holidayDate);
      await recalculatePendingRequests(holidayDate);
      imported++;
    }

    await AuditService.log(req.user!.userId, 'HOLIDAYS_IMPORTED', 'holiday', null as any,
      `Imported ${imported}, skipped ${skipped}`, req.ip);

    res.json({
      message: `Import complete. ${imported} holidays added, ${skipped} skipped.`,
      imported, skipped, errors: errors.slice(0, 10),
    });
  } catch (error) { next(error); }
});

adminRouter.get('/holidays/template', (req: AuthRequest, res: Response) => {
  const wb = XLSX.utils.book_new();
  const nextYear = new Date().getFullYear();
  const data = [
    { 'Holiday Name': "New Year's Day", Date: `${nextYear}-01-01`, Description: 'New Year celebration' },
    { 'Holiday Name': 'Republic Day', Date: `${nextYear}-01-26`, Description: 'National holiday' },
    { 'Holiday Name': 'Holi', Date: `${nextYear}-03-14`, Description: 'Festival of Colors' },
  ];
  const ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = [{ width: 25 }, { width: 15 }, { width: 30 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Holidays');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=holiday_template.xlsx');
  res.send(buf);
});

// ========================
// ALL LEAVE REQUESTS
// ========================

adminRouter.get('/leave-requests', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const whereClauses: string[] = [];
    const params: any[] = [];

    if (req.query.department_id) { whereClauses.push('e.department_id = ?'); params.push(req.query.department_id); }
    if (req.query.employee_id) { whereClauses.push('lr.employee_id = ?'); params.push(req.query.employee_id); }
    if (req.query.leave_type_id) { whereClauses.push('lr.leave_type_id = ?'); params.push(req.query.leave_type_id); }
    if (req.query.status) { whereClauses.push('lr.status = ?'); params.push(req.query.status); }
    if (req.query.from_date) { whereClauses.push('lr.from_date >= ?'); params.push(req.query.from_date); }
    if (req.query.to_date) { whereClauses.push('lr.to_date <= ?'); params.push(req.query.to_date); }

    const whereClause = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';
    const page = safePage(req.query.page);
    const offset = (page - 1) * 20;

    const [countRows] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM leave_requests lr JOIN employees e ON lr.employee_id = e.id ${whereClause}`, params
    );
    const total = parseInt(countRows[0].total);

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT lr.id, lr.employee_id, lr.leave_type_id,
              DATE_FORMAT(lr.from_date, "%Y-%m-%d") as from_date,
              DATE_FORMAT(lr.to_date, "%Y-%m-%d") as to_date,
              lr.is_half_day, lr.days_count, lr.reason, lr.status, lr.manager_remarks, lr.submitted_at,
              lt.name as leave_type_name, e.name as employee_name, e.employee_code, d.name as department_name
       FROM leave_requests lr
       JOIN leave_types lt ON lr.leave_type_id = lt.id
       JOIN employees e ON lr.employee_id = e.id
       LEFT JOIN departments d ON e.department_id = d.id
       ${whereClause}
       ORDER BY lr.submitted_at DESC LIMIT 20 OFFSET ${offset}`, params
    );

    res.json({ requests: rows, total, page, totalPages: Math.max(1, Math.ceil(total / 20)) });
  } catch (error) { next(error); }
});

adminRouter.patch('/leave-requests/:id/cancel', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const request = await LeaveRequestService.adminCancelApproved(req.params.id, req.user!.userId);
    res.json(request);
  } catch (error) { next(error); }
});

// ========================
// REPORTS
// ========================

adminRouter.get('/reports/employee', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { from_date, to_date } = req.query;
    if (!from_date || !to_date) throw new AppError(400, 'VALIDATION_ERROR', 'Date range required');

    const [employees] = await pool.execute<RowDataPacket[]>(
      `SELECT e.id, e.employee_code, e.name, d.name as department_name
       FROM employees e LEFT JOIN departments d ON e.department_id = d.id
       WHERE e.is_active = true ORDER BY e.name`
    );
    const [requests] = await pool.execute<RowDataPacket[]>(
      `SELECT lr.id, lr.employee_id,
              DATE_FORMAT(lr.from_date, "%Y-%m-%d") as from_date,
              DATE_FORMAT(lr.to_date, "%Y-%m-%d") as to_date,
              lr.days_count, lr.status, lt.name as leave_type_name, e.name as employee_name
       FROM leave_requests lr
       JOIN leave_types lt ON lr.leave_type_id = lt.id
       JOIN employees e ON lr.employee_id = e.id
       WHERE lr.from_date >= ? AND lr.to_date <= ? ORDER BY e.name, lr.from_date`,
      [from_date, to_date]
    );
    const [balances] = await pool.execute<RowDataPacket[]>(
      `SELECT lb.employee_id, lb.balance, lt.name as leave_type_name, lt.yearly_allocation
       FROM leave_balances lb JOIN leave_types lt ON lb.leave_type_id = lt.id
       WHERE lb.year = ? AND lt.is_active = true`,
      [new Date().getFullYear()]
    );

    res.json({ employees, requests, balances });
  } catch (error) { next(error); }
});

adminRouter.get('/reports/department', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { from_date, to_date } = req.query;
    if (!from_date || !to_date) throw new AppError(400, 'VALIDATION_ERROR', 'Date range required');

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT d.name as department_name, SUM(lr.days_count) as total_approved_days, COUNT(*) as request_count
       FROM leave_requests lr
       JOIN employees e ON lr.employee_id = e.id
       JOIN departments d ON e.department_id = d.id
       WHERE lr.status = 'Approved' AND lr.from_date >= ? AND lr.to_date <= ?
       GROUP BY d.id, d.name ORDER BY d.name`,
      [from_date, to_date]
    );
    res.json(rows);
  } catch (error) { next(error); }
});

adminRouter.get('/reports/monthly', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const year = parseInt(req.query.year as string) || new Date().getFullYear();
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT MONTH(lr.from_date) as month, COUNT(*) as request_count, SUM(lr.days_count) as total_days
       FROM leave_requests lr WHERE lr.status = 'Approved' AND YEAR(lr.from_date) = ?
       GROUP BY MONTH(lr.from_date) ORDER BY month`, [year]
    );
    res.json(rows);
  } catch (error) { next(error); }
});

// ========================
// AUDIT LOGS
// ========================

adminRouter.get('/audit-logs', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await AuditService.getLogs(
      {
        user_id: req.query.user_id,
        action: req.query.action,
        from_date: req.query.from_date,
        to_date: req.query.to_date,
      },
      safePage(req.query.page)
    );
    res.json(result);
  } catch (error) { next(error); }
});

// ========================
// HELPERS
// ========================

/**
 * Next available PXM code. `offset` lets the caller skip ahead after a
 * UNIQUE collision from a concurrent insert.
 */
async function peekNextEmployeeCode(offset = 0): Promise<string> {
  // Order numerically, not lexically, so PXM100 doesn't outrank PXM99.
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT MAX(CAST(SUBSTRING(employee_code, 4) AS UNSIGNED)) as max_num
     FROM employees WHERE employee_code REGEXP '^PXM[0-9]+$'`
  );
  const next = (parseInt(rows[0]?.max_num) || 0) + 1 + offset;
  // Widen past 999 instead of wrapping around.
  return `PXM${String(next).padStart(3, '0')}`;
}

/**
 * Recompute day counts for pending requests spanning a changed holiday date.
 *
 * A deleted holiday adds a working day back, which can push a request past the
 * employee's remaining balance — those are flagged rather than silently inflated.
 */
async function recalculatePendingRequests(affectedDate: string): Promise<number> {
  const [pendingRequests] = await pool.execute<RowDataPacket[]>(
    `SELECT id, employee_id, leave_type_id, is_half_day, days_count,
            DATE_FORMAT(from_date, "%Y-%m-%d") as from_date,
            DATE_FORMAT(to_date, "%Y-%m-%d") as to_date
     FROM leave_requests
     WHERE status = 'Pending' AND from_date <= ? AND to_date >= ?`,
    [affectedDate, affectedDate]
  );

  let updated = 0;
  for (const request of pendingRequests) {
    const newDays = await LeaveCalculationService.calculateLeaveDays(
      LeaveCalculationService.parseDate(request.from_date),
      LeaveCalculationService.parseDate(request.to_date),
      !!request.is_half_day
    );
    if (newDays === parseFloat(request.days_count)) continue;

    const year = parseInt(request.from_date.slice(0, 4));
    const [balRows] = await pool.execute<RowDataPacket[]>(
      'SELECT balance FROM leave_balances WHERE employee_id = ? AND leave_type_id = ? AND year = ?',
      [request.employee_id, request.leave_type_id, year]
    );
    const available = balRows.length > 0 ? parseFloat(balRows[0].balance) : 0;

    if (newDays > available) {
      await pool.execute(
        `UPDATE leave_requests
         SET days_count = ?, manager_remarks = ?, updated_at = NOW()
         WHERE id = ?`,
        [newDays, `Recalculated to ${newDays} day(s) after a holiday change, which exceeds the available balance of ${available}. Review before approving.`, request.id]
      );
    } else {
      await pool.execute('UPDATE leave_requests SET days_count = ?, updated_at = NOW() WHERE id = ?', [newDays, request.id]);
    }
    updated++;
  }

  return updated;
}
