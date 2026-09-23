import React, { useState } from 'react';
import api from '../../services/api';

type ReportType = 'employee' | 'department' | 'monthly';

export function Reports() {
  const [reportType, setReportType] = useState<ReportType>('employee');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [year, setYear] = useState(new Date().getFullYear().toString());
  const [reportData, setReportData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const generateReport = async () => {
    setLoading(true);
    setError('');
    setReportData(null);

    try {
      let res;
      switch (reportType) {
        case 'employee':
          if (!fromDate || !toDate) { setError('Please select a date range'); setLoading(false); return; }
          res = await api.get(`/admin/reports/employee?from_date=${fromDate}&to_date=${toDate}`);
          break;
        case 'department':
          if (!fromDate || !toDate) { setError('Please select a date range'); setLoading(false); return; }
          res = await api.get(`/admin/reports/department?from_date=${fromDate}&to_date=${toDate}`);
          break;
        case 'monthly':
          res = await api.get(`/admin/reports/monthly?year=${year}`);
          break;
      }
      setReportData(res?.data);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to generate report');
    } finally {
      setLoading(false);
    }
  };

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  return (
    <div>
      <div className="header">
        <h1>Leave Reports</h1>
      </div>

      <div className="card">
        <div className="filters">
          <div className="form-group">
            <label>Report Type</label>
            <select value={reportType} onChange={e => { setReportType(e.target.value as ReportType); setReportData(null); }}>
              <option value="employee">Employee Leave Report</option>
              <option value="department">Department-wise Report</option>
              <option value="monthly">Monthly Leave Report</option>
            </select>
          </div>

          {reportType !== 'monthly' ? (
            <>
              <div className="form-group">
                <label>From Date</label>
                <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} />
              </div>
              <div className="form-group">
                <label>To Date</label>
                <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} />
              </div>
            </>
          ) : (
            <div className="form-group">
              <label>Year</label>
              <input type="number" value={year} onChange={e => setYear(e.target.value)} min="2020" max="2030" />
            </div>
          )}

          <button className="btn btn-primary" onClick={generateReport} disabled={loading} style={{ alignSelf: 'flex-end' }}>
            {loading ? 'Generating...' : 'Generate Report'}
          </button>
        </div>

        {error && <div className="alert alert-error">{error}</div>}
      </div>

      {/* Report Results */}
      {reportData && (
        <div className="card">
          {reportType === 'employee' && (
            <>
              <h3>Employee Leave Report</h3>
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Department</th>
                      <th>Balances</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportData.employees?.map((emp: any) => (
                      <tr key={emp.id}>
                        <td>{emp.name}</td>
                        <td>{emp.department_name}</td>
                        <td>
                          {emp.balances?.map((b: any, i: number) => (
                            <span key={i} className="badge" style={{ marginRight: 4, background: '#e3f2fd' }}>
                              {b.leave_type}: {b.balance}
                            </span>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {reportData.requests?.length > 0 && (
                <>
                  <h3 style={{ marginTop: 20 }}>Leave Requests in Period</h3>
                  <div className="table-container">
                    <table>
                      <thead>
                        <tr>
                          <th>Employee</th>
                          <th>Type</th>
                          <th>From</th>
                          <th>To</th>
                          <th>Days</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reportData.requests.map((req: any) => (
                          <tr key={req.id}>
                            <td>{req.employee_name}</td>
                            <td>{req.leave_type_name}</td>
                            <td>{new Date(req.from_date).toLocaleDateString()}</td>
                            <td>{new Date(req.to_date).toLocaleDateString()}</td>
                            <td>{req.days_count}</td>
                            <td>{req.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}

          {reportType === 'department' && (
            <>
              <h3>Department-wise Report</h3>
              {reportData.length === 0 ? (
                <div className="empty-state"><p>No data for the selected period</p></div>
              ) : (
                <div className="table-container">
                  <table>
                    <thead>
                      <tr>
                        <th>Department</th>
                        <th>Total Approved Days</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData.map((dept: any, i: number) => (
                        <tr key={i}>
                          <td>{dept.department_name}</td>
                          <td>{dept.total_approved_days}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {reportType === 'monthly' && (
            <>
              <h3>Monthly Leave Report - {year}</h3>
              {reportData.length === 0 ? (
                <div className="empty-state"><p>No approved leaves for the selected year</p></div>
              ) : (
                <div className="table-container">
                  <table>
                    <thead>
                      <tr>
                        <th>Month</th>
                        <th>Approved Requests</th>
                        <th>Total Days</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData.map((row: any) => (
                        <tr key={row.month}>
                          <td>{monthNames[parseInt(row.month) - 1]}</td>
                          <td>{row.request_count}</td>
                          <td>{row.total_days}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
