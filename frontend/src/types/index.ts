export type Role = 'Employee' | 'Manager' | 'Admin';
export type LeaveStatus = 'Pending' | 'Approved' | 'Rejected' | 'Cancelled';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  department_id: string;
  manager_id: string | null;
  is_active: boolean;
}

export interface LeaveType {
  id: string;
  name: string;
  yearly_allocation: number;
  is_active: boolean;
}

export interface LeaveBalance {
  id: string;
  employee_id: string;
  leave_type_id: string;
  leave_type_name: string;
  balance: number;
  year: number;
}

export interface LeaveRequest {
  id: string;
  employee_id: string;
  leave_type_id: string;
  leave_type_name?: string;
  employee_name?: string;
  employee_code?: string;
  designation?: string;
  department_name?: string;
  from_date: string;
  to_date: string;
  is_half_day: boolean;
  days_count: number;
  reason: string;
  status: LeaveStatus;
  manager_remarks: string | null;
  submitted_at: string;
  current_balance?: number;
}

export interface Holiday {
  id: string;
  name: string;
  holiday_date: string;
  description: string;
  year: number;
}

export interface Department {
  id: string;
  name: string;
}

export interface AuthResponse {
  token: string;
  user: {
    userId: string;
    email: string;
    role: Role;
    name: string;
  };
}
