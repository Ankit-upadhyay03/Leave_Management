import dotenv from 'dotenv';
dotenv.config();

import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import pool from './pool';
import { RowDataPacket } from 'mysql2';

/**
 * Idempotent seed.
 *
 * Every helper looks up the existing row first and reuses its id, so a second run
 * updates rather than inserting orphaned references. The previous version generated
 * fresh UUIDs each time and relied on INSERT IGNORE, which made the balance loop
 * reference discarded leave-type ids and fail on the foreign key.
 */

async function upsertDepartment(name: string): Promise<string> {
  const [rows] = await pool.execute<RowDataPacket[]>('SELECT id FROM departments WHERE name = ?', [name]);
  if (rows.length > 0) return rows[0].id;

  const id = uuidv4();
  await pool.execute('INSERT INTO departments (id, name) VALUES (?, ?)', [id, name]);
  return id;
}

/**
 * Resolve an employee code that is free, or already belongs to this employee.
 *
 * Returns null when the preferred code is held by someone else and the employee
 * already has a code of their own — in that case the existing code is kept, since
 * employee_code is UNIQUE and reassigning it would break the other record.
 */
async function resolveEmployeeCode(preferred: string, employeeId: string | null): Promise<string | null> {
  const [holder] = await pool.execute<RowDataPacket[]>(
    'SELECT id FROM employees WHERE employee_code = ?',
    [preferred]
  );

  if (holder.length === 0) return preferred;            // free
  if (employeeId && holder[0].id === employeeId) return preferred; // already ours
  return null;                                          // taken by someone else
}

/** Next free PXM code, ordered numerically so PXM100 follows PXM99. */
async function nextFreeCode(): Promise<string> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT MAX(CAST(SUBSTRING(employee_code, 4) AS UNSIGNED)) as max_num
     FROM employees WHERE employee_code REGEXP '^PXM[0-9]+$'`
  );
  const next = (parseInt(rows[0]?.max_num) || 0) + 1;
  return `PXM${String(next).padStart(3, '0')}`;
}

async function upsertEmployee(emp: {
  code: string; name: string; email: string; passwordHash: string;
  role: string; departmentId: string; managerId: string | null;
  designation: string; joining: string;
}): Promise<string> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT id, employee_code FROM employees WHERE email = ?',
    [emp.email]
  );

  if (rows.length > 0) {
    const existing = rows[0];
    // Only touch the code when it is safe to do so.
    const code = (await resolveEmployeeCode(emp.code, existing.id)) ?? existing.employee_code ?? (await nextFreeCode());

    await pool.execute(
      `UPDATE employees SET employee_code = ?, name = ?, role = ?, department_id = ?, manager_id = ?,
              designation = ?, date_of_joining = ?, is_active = true WHERE id = ?`,
      [code, emp.name, emp.role, emp.departmentId, emp.managerId, emp.designation, emp.joining, existing.id]
    );
    return existing.id;
  }

  const id = uuidv4();
  const code = (await resolveEmployeeCode(emp.code, null)) ?? (await nextFreeCode());
  await pool.execute(
    `INSERT INTO employees (id, employee_code, name, email, password_hash, role, department_id, manager_id,
                            designation, date_of_joining, is_temp_password)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, false)`,
    [id, code, emp.name, emp.email, emp.passwordHash, emp.role, emp.departmentId,
     emp.managerId, emp.designation, emp.joining]
  );
  return id;
}

async function upsertLeaveType(name: string, allocation: number): Promise<string> {
  const [rows] = await pool.execute<RowDataPacket[]>('SELECT id FROM leave_types WHERE name = ?', [name]);
  if (rows.length > 0) {
    await pool.execute('UPDATE leave_types SET yearly_allocation = ?, is_active = true WHERE id = ?',
      [allocation, rows[0].id]);
    return rows[0].id;
  }

  const id = uuidv4();
  await pool.execute('INSERT INTO leave_types (id, name, yearly_allocation) VALUES (?, ?, ?)', [id, name, allocation]);
  return id;
}

async function seed() {
  try {
    const passwordHash = await bcrypt.hash('Admin@123', 10);
    const year = new Date().getFullYear();

    const deptEng = await upsertDepartment('Engineering');
    const deptHR = await upsertDepartment('Human Resources');
    await upsertDepartment('Marketing');
    await upsertDepartment('Finance');

    const adminId = await upsertEmployee({
      code: 'PXM001', name: 'System Administrator', email: 'admin@company.com', passwordHash,
      role: 'Admin', departmentId: deptHR, managerId: null,
      designation: 'System Admin', joining: `${year}-01-01`,
    });

    const managerId = await upsertEmployee({
      code: 'PXM002', name: 'Rajesh Kumar', email: 'manager@company.com', passwordHash,
      role: 'Manager', departmentId: deptEng, managerId: adminId,
      designation: 'Engineering Manager', joining: `${year}-01-15`,
    });

    const emp1 = await upsertEmployee({
      code: 'PXM003', name: 'Amit Sharma', email: 'amit@company.com', passwordHash,
      role: 'Employee', departmentId: deptEng, managerId,
      designation: 'Software Engineer', joining: `${year}-02-01`,
    });

    const emp2 = await upsertEmployee({
      code: 'PXM004', name: 'Priya Patel', email: 'priya@company.com', passwordHash,
      role: 'Employee', departmentId: deptEng, managerId,
      designation: 'QA Engineer', joining: `${year}-03-01`,
    });

    const leaveTypes = [
      { id: await upsertLeaveType('Casual Leave', 12), allocation: 12 },
      { id: await upsertLeaveType('Sick Leave', 10), allocation: 10 },
      { id: await upsertLeaveType('Earned Leave', 18), allocation: 18 },
    ];

    // Balances reference the ids resolved above, so re-runs stay consistent.
    for (const empId of [adminId, managerId, emp1, emp2]) {
      for (const lt of leaveTypes) {
        await pool.execute(
          `INSERT INTO leave_balances (id, employee_id, leave_type_id, balance, year)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE id = id`,
          [uuidv4(), empId, lt.id, lt.allocation, year]
        );
      }
    }

    const holidays = [
      { name: "New Year's Day", date: `${year}-01-01`, desc: 'New Year celebration' },
      { name: 'Republic Day', date: `${year}-01-26`, desc: 'National holiday' },
      { name: 'Holi', date: `${year}-03-14`, desc: 'Festival of Colors' },
      { name: 'Independence Day', date: `${year}-08-15`, desc: 'National holiday' },
      { name: 'Gandhi Jayanti', date: `${year}-10-02`, desc: 'National holiday' },
      { name: 'Diwali', date: `${year}-11-01`, desc: 'Festival of Lights' },
      { name: 'Christmas', date: `${year}-12-25`, desc: 'Christmas celebration' },
    ];
    for (const h of holidays) {
      await pool.execute(
        `INSERT INTO holidays (id, name, holiday_date, description, year)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description)`,
        [uuidv4(), h.name, h.date, h.desc, year]
      );
    }

    // Report the codes actually stored, not the requested ones — a preferred code
    // may already belong to a user created through the admin UI.
    const [seeded] = await pool.execute<RowDataPacket[]>(
      `SELECT employee_code, name, email, role FROM employees
       WHERE email IN ('admin@company.com','manager@company.com','amit@company.com','priya@company.com')
       ORDER BY FIELD(role,'Admin','Manager','Employee'), name`
    );

    console.log('========================================');
    console.log('  Seed completed successfully');
    console.log('========================================');
    console.log('');
    console.log('  Login credentials (password: Admin@123)');
    console.log('');
    for (const row of seeded) {
      console.log(`  ${String(row.role).padEnd(8)} ${String(row.employee_code ?? '—').padEnd(8)} ${row.email}`);
    }
    console.log('');
    console.log(`  ${leaveTypes.length} leave types, ${holidays.length} holidays for ${year}`);
    console.log('========================================');
  } catch (error) {
    console.error('Seed FAILED:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

seed();
