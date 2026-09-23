export type Role = 'Employee' | 'Manager' | 'Admin';
export type LeaveStatus = 'Pending' | 'Approved' | 'Rejected' | 'Cancelled';

export interface JwtPayload {
  userId: string;
  email: string;
  role: Role;
  name: string;
}
