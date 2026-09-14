import { useEffect, useState, useRef, useMemo } from 'react';
import {
  Ban,
  UploadCloud,
  CheckCircle2,
  Database,
  ShieldAlert,
  Clock,
  Hash,
  AlertTriangle,
  History,
  FileText,
  FileSpreadsheet,
} from 'lucide-react';

import api from '../services/api';
import Modal from '../components/Modal';
import FilePreview from '../components/FilePreview';
import Button from '../components/Button';
import StatusBadge from '../components/StatusBadge';
import { useToast } from '../components/Toast';
import { formatNumber, formatBytes, formatDate } from '../utils/format';
import {
  MAX_UPLOAD_BYTES,
  isCsvFile,
  isXlsxFile,
  previewCsvFile,
  previewXlsxFile,
} from '../utils/upload';

function progress(version) {
  if (!version) return 0;
  const total = Number(version.total_rows || 0);
  const done = Number(version.processed_rows || 0);
  if (!total) return 0;
  return Math.min(100, Math.round((done / total) * 100));
}

export default function InternalDncDead() {
  const toast = useToast();
  const pollRef = useRef(null);
  const fileInputRef = useRef(null);

  const [summary, setSummary] = useState(null);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [historyFilter, setHistoryFilter] = useState('all');

  // Upload modal state
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [phoneColumn, setPhoneColumn] = useState('');
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);

  async function loadSummary() {
    try {
      const res = await api.get('/global-dnc');
      setSummary(res.data);
    } catch {
      // silently ignore
    } finally {
      setLoadingSummary(false);
    }
  }

  useEffect(() => {
    loadSummary();
    pollRef.current = setInterval(loadSummary, 3000);
    return () => clearInterval(pollRef.current);
  }, []);

  function resetUpload() {
    setFile(null);
    setPreview(null);
    setPhoneColumn('');
    setUploadPercent(0);
  }

  function triggerUpload() {
    if (busy) return;
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  }

  async function handleFileInputChange(e) {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    if (selectedFile.size > MAX_UPLOAD_BYTES) {
      toast.push('File is larger than 500 MB.');
      return;
    }

    setFile(selectedFile);

    try {
      if (isCsvFile(selectedFile)) {
        const data = await previewCsvFile(selectedFile);
        setPreview(data);
        setPhoneColumn(data.suggestedPhoneColumn || data.headers?.[0] || '');
        setUploadModalOpen(true);
        return;
      }
      if (isXlsxFile(selectedFile)) {
        const data = await previewXlsxFile(selectedFile);
        setPreview(data);
        setPhoneColumn(data.suggestedPhoneColumn || data.headers?.[0] || '');
        setUploadModalOpen(true);
        return;
      }
      setPreview({ headers: ['Phone No'], sampleRows: [], suggestedPhoneColumn: 'Phone No' });
      setPhoneColumn('Phone No');
      setUploadModalOpen(true);
    } catch (error) {
      resetUpload();
      setUploadModalOpen(false);
      toast.push(error.message || 'Could not preview file');
    }
  }

  function closeUpload() {
    if (busy) return;
    setUploadModalOpen(false);
    resetUpload();
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  async function uploadDnc() {
    if (!file || !phoneColumn) return;

    setBusy(true);
    setUploadPercent(0);

    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('phoneColumn', phoneColumn);

      await api.post('/global-dnc/upload', fd, {
        onUploadProgress: (event) => {
          if (!event.total) return;
          setUploadPercent(Math.min(100, Math.round((event.loaded / event.total) * 100)));
        },
      });

      toast.push('Global DNC/Dead list uploaded. Processing has started.');
      closeUpload();
      setTimeout(loadSummary, 1000);
    } catch (error) {
      toast.push(error.message || 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  const active = summary?.active || null;
  const recent = summary?.recent || [];
  const isProcessing = active?.status === 'processing' || recent.some((v) => v.status === 'processing');
  const percent = progress(active);

  const filteredHistory = useMemo(() => {
    if (historyFilter === 'active') return recent.filter((v) => v.status === 'active');
    if (historyFilter === 'inactive') return recent.filter((v) => v.status === 'inactive');
    if (historyFilter === 'failed') return recent.filter((v) => v.status === 'failed');
    return recent;
  }, [recent, historyFilter]);

  return (
    <div>
      {/* Hidden native file input triggered directly by button */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
      />

      {/* Header */}
      <div className="page-header" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <h2 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <ShieldAlert size={24} color="var(--color-danger, #b42318)" />
              Internal DNC / Dead
            </h2>
            <p className="page-sub" style={{ marginTop: 4 }}>
              A single global list of Do-Not-Call and Dead numbers that is automatically
              excluded from <strong>all</strong> campaigns during scrubbing — Medicare, ACA, and any others.
              Upload once, applies everywhere.
            </p>
          </div>
          <Button
            type="button"
            onClick={triggerUpload}
            disabled={busy || isProcessing}
          >
            <UploadCloud size={16} />
            {isProcessing ? 'Processing…' : 'Upload DNC / Dead List'}
          </Button>
        </div>
      </div>

      {/* Active version display */}
      {loadingSummary ? (
        <p className="page-sub">Loading…</p>
      ) : active ? (
        <div className="card" style={{ marginBottom: 24, padding: '20px 24px' }}>
          {/* Header row */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 16,
              borderBottom: '1px solid var(--color-border)',
              paddingBottom: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 10,
                  background: 'rgba(180, 35, 24, 0.1)',
                  border: '1px solid rgba(180, 35, 24, 0.25)',
                  display: 'grid',
                  placeItems: 'center',
                  color: 'var(--color-danger, #b42318)',
                }}
              >
                <Ban size={22} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>
                  Active Global DNC / Dead (v{active.version_number})
                </h3>
                <p className="page-sub" style={{ margin: '2px 0 0', fontSize: '0.78rem' }}>
                  {active.original_filename ? (
                    <>Source: <strong>{active.original_filename}</strong> · </>
                  ) : null}
                  Applied to every scrub job across all campaigns
                  {active.activated_at && (
                    <> · Last updated: {formatDate(active.activated_at)}</>
                  )}
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <StatusBadge value={active.status} />
              <Button
                type="button"
                size="sm"
                onClick={triggerUpload}
                disabled={busy || isProcessing}
              >
                <UploadCloud size={14} />
                {isProcessing ? 'Processing…' : 'Upload New List'}
              </Button>
            </div>
          </div>

          {/* Metric grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
              gap: 12,
            }}
          >
            <div style={{ background: 'var(--color-surface-soft, rgba(0,0,0,0.02))', padding: '12px 16px', borderRadius: 8, border: '1px solid var(--color-border)' }}>
              <span className="page-sub" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Unique Numbers</span>
              <div style={{ marginTop: 4 }}>
                <strong style={{ fontSize: '1.35rem', color: 'var(--color-primary)' }}>
                  {formatNumber(active.unique_numbers)}
                </strong>
              </div>
            </div>

            <div style={{ background: 'var(--color-surface-soft, rgba(0,0,0,0.02))', padding: '12px 16px', borderRadius: 8, border: '1px solid var(--color-border)' }}>
              <span className="page-sub" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Total Rows</span>
              <div style={{ marginTop: 4 }}>
                <strong style={{ fontSize: '1.35rem' }}>
                  {formatNumber(active.total_rows)}
                </strong>
              </div>
            </div>

            <div style={{ background: 'var(--color-surface-soft, rgba(0,0,0,0.02))', padding: '12px 16px', borderRadius: 8, border: '1px solid var(--color-border)' }}>
              <span className="page-sub" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Duplicates</span>
              <div style={{ marginTop: 4 }}>
                <strong style={{ fontSize: '1.35rem', opacity: 0.85 }}>
                  {formatNumber(active.duplicate_numbers)}
                </strong>
              </div>
            </div>

            <div style={{ background: 'var(--color-surface-soft, rgba(0,0,0,0.02))', padding: '12px 16px', borderRadius: 8, border: '1px solid var(--color-border)' }}>
              <span className="page-sub" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Invalid</span>
              <div style={{ marginTop: 4 }}>
                <strong style={{ fontSize: '1.35rem', color: Number(active.invalid_numbers) > 0 ? 'var(--color-danger, #b42318)' : 'inherit', opacity: 0.85 }}>
                  {formatNumber(active.invalid_numbers)}
                </strong>
              </div>
            </div>
          </div>

          {/* Progress bar if processing */}
          {active.status === 'processing' && (
            <div style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span className="page-sub">Processing list...</span>
                <strong>{percent}%</strong>
              </div>
              <div style={{ height: 9, width: '100%', borderRadius: 999, background: 'var(--color-border)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${Math.max(percent, 2)}%`,
                  background: 'var(--color-success)',
                  transition: 'width .3s ease',
                }} />
              </div>
              <div className="page-sub" style={{ marginTop: 6, fontSize: '.8rem' }}>
                {formatNumber(active.processed_rows)} / {formatNumber(active.total_rows)} rows
              </div>
            </div>
          )}
        </div>
      ) : (
        <div
          className="card"
          style={{
            border: '2px dashed var(--color-border)',
            borderRadius: 14,
            padding: '48px 24px',
            textAlign: 'center',
            marginBottom: 24,
          }}
        >
          <Ban size={40} style={{ opacity: 0.25, marginBottom: 12 }} />
          <p style={{ margin: 0, fontWeight: 600 }}>No Global DNC / Dead list uploaded yet.</p>
          <p className="page-sub" style={{ marginTop: 6 }}>
            Upload a CSV or XLSX file with phone numbers. This list will apply to all campaigns automatically.
          </p>
          <div style={{ marginTop: 16 }}>
            <Button type="button" onClick={triggerUpload}>
              <UploadCloud size={16} />
              Upload First List
            </Button>
          </div>
        </div>
      )}

      {/* Upload Logs & History Table */}
      <div className="card" style={{ marginTop: 24, padding: '20px 24px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 12,
            marginBottom: 18,
            borderBottom: '1px solid var(--color-border)',
            paddingBottom: 14,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                background: 'var(--color-surface-soft, rgba(255,255,255,0.05))',
                border: '1px solid var(--color-border)',
                display: 'grid',
                placeItems: 'center',
                color: 'var(--color-primary)',
              }}
            >
              <History size={18} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>
                Global DNC / Dead Upload Logs
              </h3>
              <p className="page-sub" style={{ margin: '2px 0 0', fontSize: '0.78rem' }}>
                History of files uploaded under Global DNC & Dead numbers exclusion list.
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {['all', 'active', 'inactive', 'failed'].map((filterKey) => {
              const count =
                filterKey === 'all'
                  ? recent.length
                  : recent.filter((h) => h.status === filterKey).length;
              const isActive = historyFilter === filterKey;
              return (
                <button
                  key={filterKey}
                  type="button"
                  onClick={() => setHistoryFilter(filterKey)}
                  style={{
                    border: '1px solid',
                    borderColor: isActive ? 'var(--color-primary)' : 'var(--color-border)',
                    background: isActive ? 'var(--color-primary)' : 'transparent',
                    color: isActive ? '#fff' : 'var(--color-text)',
                    borderRadius: 20,
                    padding: '4px 12px',
                    fontSize: '0.76rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    textTransform: 'capitalize',
                    transition: 'all .15s ease',
                  }}
                >
                  {filterKey} ({count})
                </button>
              );
            })}
          </div>
        </div>

        {filteredHistory.length === 0 ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--color-muted)' }}>
            <FileSpreadsheet size={32} style={{ opacity: 0.35, marginBottom: 8 }} />
            <p style={{ margin: 0, fontSize: '0.88rem' }}>
              No upload logs found yet.
            </p>
            <p style={{ margin: '4px 0 0', fontSize: '0.78rem', opacity: 0.7 }}>
              Click "Upload DNC / Dead List" above to upload a list.
            </p>
          </div>
        ) : (
          <div className="table-wrap" style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Uploaded</th>
                  <th>File Name</th>
                  <th>Version</th>
                  <th style={{ textAlign: 'right' }}>Total Rows</th>
                  <th style={{ textAlign: 'right' }}>Unique Numbers</th>
                  <th style={{ textAlign: 'right' }}>Duplicates</th>
                  <th style={{ textAlign: 'right' }}>Invalid</th>
                  <th>Status</th>
                  <th>Uploaded By</th>
                </tr>
              </thead>
              <tbody>
                {filteredHistory.map((item) => (
                  <tr key={item.id}>
                    <td style={{ fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
                      {formatDate(item.created_at)}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <FileText size={14} style={{ opacity: 0.6, flexShrink: 0 }} />
                        <span style={{ fontWeight: 600, fontSize: '0.84rem' }} title={item.original_filename}>
                          {item.original_filename || 'Direct Upload'}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span
                        style={{
                          fontSize: '0.74rem',
                          fontWeight: 700,
                          background: 'var(--color-surface)',
                          border: '1px solid var(--color-border)',
                          padding: '2px 6px',
                          borderRadius: 4,
                        }}
                      >
                        v{item.version_number}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>
                      {formatNumber(item.total_rows)}
                    </td>
                    <td
                      style={{
                        textAlign: 'right',
                        fontWeight: 700,
                        color: item.unique_numbers > 0 ? 'var(--color-primary)' : 'inherit',
                      }}
                    >
                      {formatNumber(item.unique_numbers)}
                    </td>
                    <td style={{ textAlign: 'right', opacity: 0.75 }}>
                      {formatNumber(item.duplicate_numbers)}
                    </td>
                    <td style={{ textAlign: 'right', opacity: 0.75 }}>
                      {formatNumber(item.invalid_numbers)}
                    </td>
                    <td>
                      <StatusBadge value={item.status} />
                      {item.status === 'failed' && item.failure_reason && (
                        <div
                          style={{
                            fontSize: '0.72rem',
                            color: '#b42318',
                            marginTop: 2,
                            maxWidth: 180,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                          title={item.failure_reason}
                        >
                          {item.failure_reason}
                        </div>
                      )}
                    </td>
                    <td style={{ fontSize: '0.82rem', opacity: 0.85 }}>
                      {item.first_name ? `${item.first_name} ${item.last_name || ''}` : 'System'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Upload Confirmation & Preview Modal (matches InternalSales) */}
      {uploadModalOpen && file && (
        <Modal
          title="Upload Global DNC / Dead List"
          onClose={closeUpload}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* File info summary */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 14px',
                background: 'var(--color-surface-soft, rgba(0,0,0,0.03))',
                borderRadius: 8,
                border: '1px solid var(--color-border)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <FileSpreadsheet size={24} style={{ color: 'var(--color-primary)' }} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>
                    {file.name}
                  </div>
                  <div style={{ fontSize: '0.76rem', opacity: 0.7 }}>
                    {formatBytes(file.size)} · {preview?.headers?.length || 0} columns detected
                  </div>
                </div>
              </div>

              {!busy && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (fileInputRef.current) {
                      fileInputRef.current.value = '';
                      fileInputRef.current.click();
                    }
                  }}
                >
                  Change file
                </Button>
              )}
            </div>

            {/* Phone column picker */}
            <div className="field" style={{ marginBottom: 0 }}>
              <label style={{ fontWeight: 600, fontSize: '0.84rem' }}>
                Select Phone Number Column
              </label>
              <select
                className="input"
                value={phoneColumn}
                onChange={(e) => setPhoneColumn(e.target.value)}
                disabled={busy}
              >
                <option value="">Select phone column</option>
                {(preview?.headers || []).map((header) => (
                  <option key={header} value={header}>
                    {header}
                  </option>
                ))}
              </select>
            </div>

            {/* Sample preview table */}
            {preview?.sampleRows?.length > 0 && (
              <div>
                <div style={{ fontSize: '0.78rem', fontWeight: 600, opacity: 0.8, marginBottom: 6 }}>
                  Data preview (first {preview.sampleRows.length} rows)
                </div>
                <FilePreview
                  headers={preview.headers}
                  rows={preview.sampleRows}
                  phoneColumn={phoneColumn}
                />
              </div>
            )}

            {/* Progress bar during upload */}
            {busy && (
              <div style={{ marginTop: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span className="page-sub" style={{ fontSize: '0.82rem' }}>
                    Uploading file...
                  </span>
                  <strong>{uploadPercent}%</strong>
                </div>
                <div
                  style={{
                    width: '100%',
                    height: 8,
                    background: 'var(--color-border)',
                    borderRadius: 999,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${uploadPercent}%`,
                      height: '100%',
                      background: 'var(--color-success)',
                      transition: 'width .2s ease',
                    }}
                  />
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="modal-actions" style={{ marginTop: 12 }}>
              {!busy && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={closeUpload}
                >
                  Cancel
                </Button>
              )}
              <Button
                type="button"
                onClick={uploadDnc}
                disabled={busy || !file || !phoneColumn}
              >
                {busy ? (
                  <>
                    <UploadCloud size={16} />
                    Uploading…
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={16} />
                    Upload DNC / Dead List
                  </>
                )}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
