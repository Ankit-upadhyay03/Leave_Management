import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import { DESIGNATIONS } from '../../data/designations';
import { COUNTRY_CODES, splitMobile, joinMobile } from '../../data/countryCodes';
import { SearchableSelect } from '../../components/SearchableSelect';

const EMAIL_DOMAIN = '';

interface Employee {
  id: string;
  employee_code: string;
  name: string;
  email: string;
  mobile: string;
  role: string;
  department_id: string;
  department_name: string;
  designation: string;
  manager_id: string | null;
  manager_name: string | null;
  is_active: boolean;
  is_temp_password: boolean;
  date_of_joining: string;
}

interface Department { id: string; name: string; }

export function EmployeeManagement() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [generatedPassword, setGeneratedPassword] = useState('');
  const [generatedCode, setGeneratedCode] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);
  const [nextCode, setNextCode] = useState('');

  const [formData, setFormData] = useState({
    first_name: '',
    last_name: '',
    email_prefix: '',
    country_code: '+91',
    phone: '',
    department_id: '',
    designation_category: '',
    designation: '',
    manager_id: '',
    role: 'Employee',
    date_of_joining: '',
  });

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [empRes, deptRes, codeRes] = await Promise.all([
        api.get('/admin/employees'),
        api.get('/admin/departments'),
        api.get('/admin/next-employee-code'),
      ]);
      setEmployees(empRes.data);
      setDepartments(deptRes.data);
      setNextCode(codeRes.data.next_code);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const openAddModal = () => {
    setEditingEmployee(null);
    setFormData({
      first_name: '', last_name: '', email_prefix: '', country_code: '+91',
      phone: '', department_id: '', designation_category: '', designation: '',
      manager_id: '', role: 'Employee', date_of_joining: new Date().toISOString().split('T')[0],
    });
    setError(''); setSuccess(''); setGeneratedPassword(''); setGeneratedCode('');
    setShowModal(true);
  };

  const openEditModal = (emp: Employee) => {
    setEditingEmployee(emp);
    const nameParts = emp.name.split(' ');
    const emailPrefix = emp.email.replace(EMAIL_DOMAIN, '');
    const { code, number } = splitMobile(emp.mobile);
    const foundCategory = DESIGNATIONS.find(g => g.items.includes(emp.designation || ''))?.category || '';

    setFormData({
      first_name: nameParts[0] || '',
      last_name: nameParts.slice(1).join(' ') || '',
      email_prefix: emailPrefix,
      country_code: code,
      phone: number,
      department_id: emp.department_id || '',
      designation_category: foundCategory,
      designation: emp.designation || '',
      manager_id: emp.manager_id || '',
      role: emp.role,
      date_of_joining: emp.date_of_joining ? emp.date_of_joining.split('T')[0] : '',
    });
    setError(''); setSuccess(''); setGeneratedPassword(''); setGeneratedCode('');
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setSuccess('');

    const fullName = `${formData.first_name.trim()} ${formData.last_name.trim()}`.trim();
    const fullEmail = formData.email_prefix.trim().toLowerCase();
    const fullMobile = joinMobile(formData.country_code, formData.phone);

    if (!formData.first_name.trim() || !formData.email_prefix.trim() || !formData.department_id || !formData.role) {
      setError('First Name, Email, Department, and Role are required');
      return;
    }

    try {
      if (editingEmployee) {
        await api.put(`/admin/employees/${editingEmployee.id}`, {
          name: fullName, email: fullEmail, mobile: fullMobile || null,
          department_id: formData.department_id, designation: formData.designation || null,
          manager_id: formData.manager_id || null, role: formData.role,
        });
        setSuccess('User updated successfully');
        setTimeout(() => { setShowModal(false); loadData(); }, 1000);
      } else {
        const response = await api.post('/admin/employees', {
          name: fullName, email: fullEmail, mobile: fullMobile || null,
          department_id: formData.department_id, designation: formData.designation || null,
          manager_id: formData.manager_id || null, role: formData.role,
          date_of_joining: formData.date_of_joining || null,
        });
        setGeneratedPassword(response.data.temp_password);
        setGeneratedCode(response.data.employee_code);
        setSuccess('Account created successfully!');
        loadData();
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Operation failed');
    }
  };

  const handleDeactivate = async (id: string) => {
    if (!confirm('Deactivate this user? They will not be able to login.')) return;
    try { await api.patch(`/admin/employees/${id}/deactivate`); loadData(); }
    catch (err: any) { alert(err.response?.data?.message || 'Failed'); }
  };

  const handleActivate = async (id: string) => {
    try { await api.patch(`/admin/employees/${id}/activate`); loadData(); }
    catch (err: any) { alert(err.response?.data?.message || 'Failed'); }
  };

  const handleResetPassword = async (id: string, name: string) => {
    if (!confirm(`Reset password for ${name}?`)) return;
    try {
      const res = await api.patch(`/admin/employees/${id}/reset-password`);
      alert(`Password reset!\n\nNew temporary password: ${res.data.temp_password}\n\nShare this securely with the employee.`);
    } catch (err: any) { alert(err.response?.data?.message || 'Failed'); }
  };

  const handleDelete = async (emp: Employee) => {
    // Permanent and irreversible, so confirm explicitly and warn how it differs from Disable.
    if (!confirm(
      `Permanently delete ${emp.name} (${emp.employee_code || 'no code'})?\n\n` +
      `This cannot be undone. Use "Disable" instead if you only want to block login while keeping records.\n\n` +
      `Deletion is only allowed for accounts with no leave history.`
    )) return;

    try {
      await api.delete(`/admin/employees/${emp.id}`);
      setSuccess(`${emp.name} was permanently deleted.`);
      setTimeout(() => setSuccess(''), 4000);
      loadData();
    } catch (err: any) {
      // The API blocks deletion of users with history / reportees / last admin — surface why.
      alert(err.response?.data?.message || 'Failed to delete user');
    }
  };

  const managers = employees.filter(e => (e.role === 'Manager' || e.role === 'Admin') && e.is_active);

  const filteredEmployees = employees.filter(emp => {
    const s = searchTerm.toLowerCase();
    const matchesSearch = !searchTerm || emp.name.toLowerCase().includes(s) || emp.email.toLowerCase().includes(s) || (emp.employee_code || '').toLowerCase().includes(s);
    const matchesRole = !roleFilter || emp.role === roleFilter;
    const matchesStatus = !statusFilter || (statusFilter === 'active' ? emp.is_active : !emp.is_active);
    return matchesSearch && matchesRole && matchesStatus;
  });

  if (loading) return <div className="loading"><div className="spinner"></div></div>;

  return (
    <div>
      <div className="header">
        <h1>User Management</h1>
        <button className="btn btn-primary" onClick={openAddModal}>+ Add User</button>
      </div>

      {success && !showModal && <div className="alert alert-success" style={{ marginBottom: 16 }}>{success}</div>}

      {/* Filters */}
      <div className="filters" style={{ marginBottom: 20 }}>
        <div className="form-group" style={{ flex: 1 }}>
          <input placeholder="Search by name, email, or employee ID..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} style={{ width: '100%' }} />
        </div>
        <div className="form-group">
          <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
            <option value="">All Roles</option>
            <option value="Employee">Employee</option>
            <option value="Manager">Manager</option>
            <option value="Admin">Admin</option>
          </select>
        </div>
        <div className="form-group">
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
      </div>

      {/* Employee Table */}
      <div className="card">
        <div style={{ marginBottom: 12, color: '#666', fontSize: '0.9rem' }}>
          Showing {filteredEmployees.length} of {employees.length} users
        </div>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Emp ID</th><th>Name</th><th>Email</th><th>Role</th><th>Department</th><th>Manager</th><th>Status</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredEmployees.map(emp => (
                <tr key={emp.id} style={{ opacity: emp.is_active ? 1 : 0.6 }}>
                  <td><code style={{ background: '#f0f0f0', padding: '2px 6px', borderRadius: 3 }}>{emp.employee_code || '—'}</code></td>
                  <td>
                    <strong>{emp.name}</strong>
                    {emp.designation && <div style={{ fontSize: '0.78rem', color: '#888' }}>{emp.designation}</div>}
                  </td>
                  <td style={{ fontSize: '0.88rem' }}>{emp.email}</td>
                  <td>
                    <span className={`badge ${emp.role === 'Admin' ? 'badge-rejected' : emp.role === 'Manager' ? 'badge-pending' : 'badge-approved'}`}>
                      {emp.role}
                    </span>
                  </td>
                  <td>{emp.department_name || '—'}</td>
                  <td>{emp.manager_name || '—'}</td>
                  <td>
                    <span className={`badge ${emp.is_active ? 'badge-approved' : 'badge-cancelled'}`}>
                      {emp.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      <button className="btn btn-outline btn-sm" onClick={() => openEditModal(emp)}>Edit</button>
                      <button className="btn btn-outline btn-sm" onClick={() => handleResetPassword(emp.id, emp.name)}>Reset Pwd</button>
                      {emp.is_active
                        ? <button className="btn btn-danger btn-sm" onClick={() => handleDeactivate(emp.id)}>Disable</button>
                        : <button className="btn btn-success btn-sm" onClick={() => handleActivate(emp.id)}>Enable</button>
                      }
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => handleDelete(emp)}
                        title="Permanently delete this user (only if they have no leave history)"
                        style={{ background: '#7f1d1d' }}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ====== ADD / EDIT USER MODAL ====== */}
      {showModal && (
        <div className="modal-overlay" onClick={() => { if (!generatedPassword) setShowModal(false); }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 640 }}>
            <h2>{editingEmployee ? '✏️ Edit User' : '+ Add New User'}</h2>

            {error && <div className="alert alert-error">{error}</div>}
            {success && !generatedPassword && <div className="alert alert-success">{success}</div>}

            {/* ---- SUCCESS: Show generated credentials ---- */}
            {generatedPassword && (
              <div style={{ background: '#e8f5e9', border: '2px solid #2e7d32', borderRadius: 8, padding: 20, marginBottom: 16 }}>
                <strong style={{ color: '#2e7d32', fontSize: '1.1rem' }}>✓ Account Created Successfully</strong>
                <p style={{ margin: '10px 0 0', fontSize: '0.9rem', color: '#333' }}>Share these credentials with the employee:</p>
                <div style={{ background: '#fff', padding: 16, borderRadius: 6, marginTop: 12, border: '1px solid #c8e6c9' }}>
                  <table style={{ width: '100%' }}>
                    <tbody>
                      <tr><td style={{ padding: '4px 0', color: '#666', width: 140 }}>Employee ID:</td><td style={{ fontWeight: 700 }}>{generatedCode}</td></tr>
                      <tr><td style={{ padding: '4px 0', color: '#666' }}>Email:</td><td style={{ fontWeight: 700 }}>{formData.email_prefix}</td></tr>
                      <tr><td style={{ padding: '4px 0', color: '#666' }}>Temp Password:</td><td style={{ fontWeight: 700, color: '#c62828', fontSize: '1.1rem', fontFamily: 'monospace' }}>{generatedPassword}</td></tr>
                    </tbody>
                  </table>
                </div>
                <p style={{ margin: '12px 0 0', fontSize: '0.8rem', color: '#666' }}>
                  📧 A welcome email has been sent (if SMTP is configured).<br/>
                  🔐 The user will be required to change password on first login.
                </p>
                <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setShowModal(false)}>Done</button>
              </div>
            )}

            {/* ---- FORM ---- */}
            {!generatedPassword && (
              <form onSubmit={handleSubmit}>
                {/* Auto Employee ID */}
                {!editingEmployee && (
                  <div style={{ background: '#f5f7fa', padding: '10px 14px', borderRadius: 6, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ color: '#666', fontSize: '0.9rem' }}>Employee ID:</span>
                    <strong style={{ fontFamily: 'monospace', fontSize: '1.05rem' }}>{nextCode}</strong>
                    <span style={{ color: '#999', fontSize: '0.8rem' }}>(auto-generated)</span>
                  </div>
                )}

                {/* Name */}
                <div className="form-row">
                  <div className="form-group">
                    <label>First Name *</label>
                    <input value={formData.first_name} onChange={e => setFormData(f => ({ ...f, first_name: e.target.value }))} required placeholder="Amit" />
                  </div>
                  <div className="form-group">
                    <label>Last Name</label>
                    <input value={formData.last_name} onChange={e => setFormData(f => ({ ...f, last_name: e.target.value }))} placeholder="Sharma" />
                  </div>
                </div>

                {/* Email */}
                <div className="form-group">
                  <label>Email *</label>
                  <input
                    type="email"
                    value={formData.email_prefix}
                    onChange={e => setFormData(f => ({ ...f, email_prefix: e.target.value }))}
                    required
                    placeholder="amit.sharma@gmail.com"
                    style={{ width: '100%' }}
                  />
                </div>

                {/* Phone with country code */}
                <div className="form-group">
                  <label>Phone Number</label>
                  <div style={{ display: 'flex', gap: 0 }}>
                    <select
                      value={formData.country_code}
                      onChange={e => setFormData(f => ({ ...f, country_code: e.target.value }))}
                      style={{ width: 140, borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
                    >
                      {COUNTRY_CODES.map(cc => (
                        <option key={`${cc.flag}${cc.code}${cc.country}`} value={cc.code}>
                          {cc.flag} {cc.code} {cc.country}
                        </option>
                      ))}
                    </select>
                    <input
                      value={formData.phone}
                      onChange={e => setFormData(f => ({ ...f, phone: e.target.value.replace(/[^0-9]/g, '') }))}
                      placeholder="9876543210"
                      maxLength={10}
                      style={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0, flex: 1 }}
                    />
                  </div>
                </div>

                {/* Department + Role */}
                <div className="form-row">
                  <div className="form-group">
                    <label>Department *</label>
                    <select value={formData.department_id} onChange={e => setFormData(f => ({ ...f, department_id: e.target.value }))} required>
                      <option value="">Select Department</option>
                      {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Role *</label>
                    <select value={formData.role} onChange={e => setFormData(f => ({ ...f, role: e.target.value }))}>
                      <option value="Employee">Employee</option>
                      <option value="Manager">Manager</option>
                      <option value="Admin">Admin</option>
                    </select>
                  </div>
                </div>

                {/* Designation - Category then searchable designation */}
                <div className="form-row">
                  <div className="form-group">
                    <label>Designation Category</label>
                    <select
                      value={formData.designation_category}
                      onChange={e => {
                        setFormData(f => ({ ...f, designation_category: e.target.value, designation: '' }));
                      }}
                    >
                      <option value="">All Categories</option>
                      {DESIGNATIONS.map(g => (
                        <option key={g.category} value={g.category}>{g.category}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Designation</label>
                    <SearchableSelect
                      placeholder="Search designation..."
                      value={formData.designation}
                      onChange={val => {
                        setFormData(f => ({ ...f, designation: val }));
                        // Auto-set category if not already set
                        if (!formData.designation_category) {
                          const cat = DESIGNATIONS.find(g => g.items.includes(val))?.category || '';
                          setFormData(f => ({ ...f, designation: val, designation_category: cat }));
                        }
                      }}
                      options={
                        formData.designation_category
                          ? DESIGNATIONS.filter(g => g.category === formData.designation_category)
                              .flatMap(g => g.items.map(item => ({ value: item, label: item, group: g.category })))
                          : DESIGNATIONS.flatMap(g => g.items.map(item => ({ value: item, label: item, group: g.category })))
                      }
                    />
                  </div>
                </div>

                {/* Manager + Date of Joining */}
                <div className="form-row">
                  <div className="form-group">
                    <label>Reporting Manager</label>
                    <select value={formData.manager_id} onChange={e => setFormData(f => ({ ...f, manager_id: e.target.value }))}>
                      <option value="">None</option>
                      {managers.map(m => <option key={m.id} value={m.id}>{m.name} ({m.role})</option>)}
                    </select>
                  </div>
                  {!editingEmployee && (
                    <div className="form-group">
                      <label>Date of Joining</label>
                      <input type="date" value={formData.date_of_joining} onChange={e => setFormData(f => ({ ...f, date_of_joining: e.target.value }))} />
                    </div>
                  )}
                </div>

                {/* Info box for new users */}
                {!editingEmployee && (
                  <div className="alert alert-info" style={{ fontSize: '0.85rem', marginTop: 8 }}>
                    🔐 A temporary password will be auto-generated.<br/>
                    📧 A welcome email with login credentials will be sent to the user.<br/>
                    🔄 The user must change password on first login.
                  </div>
                )}

                <div className="modal-actions" style={{ marginTop: 20 }}>
                  <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary">
                    {editingEmployee ? 'Save Changes' : 'Create User'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
