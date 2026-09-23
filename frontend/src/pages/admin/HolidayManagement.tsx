import React, { useEffect, useState, useRef } from 'react';
import api from '../../services/api';
import { Holiday } from '../../types';

export function HolidayManagement() {
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [showModal, setShowModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [editing, setEditing] = useState<Holiday | null>(null);
  const [formData, setFormData] = useState({ name: '', holiday_date: '', description: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [importResult, setImportResult] = useState<any>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { loadHolidays(); }, [year]);

  const loadHolidays = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/holidays?year=${year}`);
      setHolidays(res.data);
    } catch (error) {
      console.error('Error loading holidays:', error);
    } finally {
      setLoading(false);
    }
  };

  const openAdd = () => {
    setEditing(null);
    setFormData({ name: '', holiday_date: '', description: '' });
    setError('');
    setShowModal(true);
  };

  const openEdit = (h: Holiday) => {
    setEditing(h);
    setFormData({ name: h.name, holiday_date: h.holiday_date.split('T')[0], description: h.description });
    setError('');
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      if (editing) {
        await api.put(`/admin/holidays/${editing.id}`, formData);
      } else {
        await api.post('/admin/holidays', formData);
      }
      setShowModal(false);
      loadHolidays();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Operation failed');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this holiday?')) return;
    try {
      await api.delete(`/admin/holidays/${id}`);
      loadHolidays();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to delete');
    }
  };

  const handleImport = async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) { setError('Please select a file'); return; }

    setImporting(true);
    setImportResult(null);
    setError('');

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await api.post('/admin/holidays/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setImportResult(res.data);
      loadHolidays();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const downloadTemplate = async () => {
    try {
      const res = await api.get('/admin/holidays/template', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'holiday_template.xlsx');
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      alert('Failed to download template');
    }
  };

  if (loading) return <div className="loading"><div className="spinner"></div></div>;

  return (
    <div>
      <div className="header">
        <h1>Holiday Management</h1>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button className="btn btn-outline btn-sm" onClick={() => setYear(y => y - 1)}>←</button>
            <span style={{ fontWeight: 600, minWidth: 40, textAlign: 'center' }}>{year}</span>
            <button className="btn btn-outline btn-sm" onClick={() => setYear(y => y + 1)}>→</button>
          </div>
          <button className="btn btn-outline" onClick={() => { setShowImportModal(true); setImportResult(null); setError(''); }}>
            📄 Import from File
          </button>
          <button className="btn btn-primary" onClick={openAdd}>+ Add Holiday</button>
        </div>
      </div>

      {/* Holiday Table */}
      <div className="card">
        {holidays.length === 0 ? (
          <div className="empty-state"><p>No holidays configured for {year}</p></div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr><th>#</th><th>Holiday Name</th><th>Date</th><th>Day</th><th>Description</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {holidays.map((h, i) => {
                  const d = new Date(h.holiday_date);
                  return (
                    <tr key={h.id}>
                      <td>{i + 1}</td>
                      <td><strong>{h.name}</strong></td>
                      <td>{d.toLocaleDateString()}</td>
                      <td style={{ color: '#666' }}>{d.toLocaleDateString('en-US', { weekday: 'long' })}</td>
                      <td>{h.description}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn btn-outline btn-sm" onClick={() => openEdit(h)}>Edit</button>
                          <button className="btn btn-danger btn-sm" onClick={() => handleDelete(h.id)}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ marginTop: 12, color: '#666', fontSize: '0.85rem' }}>
          Total: {holidays.length} holidays for {year}
        </div>
      </div>

      {/* Add/Edit Holiday Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>{editing ? 'Edit Holiday' : 'Add Holiday'}</h2>
            {error && <div className="alert alert-error">{error}</div>}
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Holiday Name *</label>
                <input value={formData.name} onChange={e => setFormData(f => ({ ...f, name: e.target.value }))} maxLength={100} required placeholder="e.g. Diwali" />
              </div>
              <div className="form-group">
                <label>Date *</label>
                <input type="date" value={formData.holiday_date} onChange={e => setFormData(f => ({ ...f, holiday_date: e.target.value }))} required />
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea value={formData.description} onChange={e => setFormData(f => ({ ...f, description: e.target.value }))} rows={3} maxLength={500} placeholder="Brief description..." />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">{editing ? 'Update' : 'Add Holiday'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {showImportModal && (
        <div className="modal-overlay" onClick={() => setShowImportModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 550 }}>
            <h2>📄 Import Holidays from File</h2>

            {error && <div className="alert alert-error">{error}</div>}

            {importResult ? (
              <div>
                <div className="alert alert-success">
                  <strong>Import Complete!</strong><br />
                  ✓ {importResult.imported} holidays added<br />
                  {importResult.skipped > 0 && <>⚠ {importResult.skipped} skipped</>}
                </div>
                {importResult.errors?.length > 0 && (
                  <div style={{ background: '#fff3e0', padding: 12, borderRadius: 6, marginTop: 12, fontSize: '0.85rem' }}>
                    <strong>Issues:</strong>
                    <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
                      {importResult.errors.map((e: string, i: number) => <li key={i}>{e}</li>)}
                    </ul>
                  </div>
                )}
                <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setShowImportModal(false)}>Done</button>
              </div>
            ) : (
              <div>
                <p style={{ color: '#555', lineHeight: 1.6 }}>
                  Upload a CSV or Excel file with holiday data. The file should have columns:
                </p>

                <div style={{ background: '#f5f7fa', padding: 14, borderRadius: 6, margin: '12px 0', fontFamily: 'monospace', fontSize: '0.85rem' }}>
                  <strong>Holiday Name</strong> | <strong>Date</strong> | <strong>Description</strong><br />
                  New Year's Day | 2026-01-01 | New Year celebration<br />
                  Republic Day | 2026-01-26 | National holiday<br />
                  Holi | 2026-03-14 | Festival of Colors
                </div>

                <p style={{ fontSize: '0.85rem', color: '#666' }}>
                  Supported formats: <strong>.xlsx, .xls, .csv</strong><br />
                  Date format: YYYY-MM-DD (e.g., 2026-01-26)
                </p>

                <button className="btn btn-outline btn-sm" onClick={downloadTemplate} style={{ marginBottom: 16 }}>
                  📥 Download Template File
                </button>

                <div className="form-group">
                  <label>Select File *</label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    style={{ padding: 8, border: '2px dashed #ddd', borderRadius: 6, width: '100%', cursor: 'pointer' }}
                  />
                </div>

                <div className="modal-actions">
                  <button type="button" className="btn btn-outline" onClick={() => setShowImportModal(false)}>Cancel</button>
                  <button className="btn btn-primary" onClick={handleImport} disabled={importing}>
                    {importing ? 'Importing...' : '📤 Import Holidays'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
