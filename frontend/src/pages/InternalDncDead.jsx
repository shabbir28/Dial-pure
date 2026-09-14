import { useEffect, useState, useRef } from 'react';
import {
  Ban,
  UploadCloud,
  CheckCircle2,
  Database,
  ShieldAlert,
  Clock,
  Hash,
  AlertTriangle,
} from 'lucide-react';

import api from '../services/api';
import FileDrop from '../components/FileDrop';
import FilePreview from '../components/FilePreview';
import Button from '../components/Button';
import StatusBadge from '../components/StatusBadge';
import { useToast } from '../components/Toast';
import { formatNumber } from '../utils/format';
import {
  MAX_UPLOAD_BYTES,
  isCsvFile,
  isXlsxFile,
  previewCsvFile,
  previewXlsxFile,
} from '../utils/upload';

function StatCard({ label, value, icon: Icon, accent }) {
  return (
    <div style={{
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 14,
      padding: '18px 22px',
      display: 'flex',
      alignItems: 'center',
      gap: 16,
    }}>
      <div style={{
        width: 46,
        height: 46,
        borderRadius: 12,
        background: `${accent}18`,
        border: `1px solid ${accent}30`,
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
      }}>
        <Icon size={20} color={accent} />
      </div>
      <div>
        <div className="page-sub" style={{ margin: 0, fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {label}
        </div>
        <strong style={{ fontSize: '1.4rem', fontWeight: 700, lineHeight: 1.2 }}>
          {value}
        </strong>
      </div>
    </div>
  );
}

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

  const [summary, setSummary] = useState(null);
  const [loadingSummary, setLoadingSummary] = useState(true);

  // Upload panel state
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [phoneColumn, setPhoneColumn] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);
  const [showUpload, setShowUpload] = useState(false);

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

  async function onFile(next) {
    if (!next) return;

    if (next.size > MAX_UPLOAD_BYTES) {
      toast.push('File is larger than 500 MB.');
      return;
    }

    setFile(next);

    try {
      if (isCsvFile(next)) {
        const data = await previewCsvFile(next);
        setPreview(data);
        setPhoneColumn(data.suggestedPhoneColumn || data.headers?.[0] || '');
        return;
      }
      if (isXlsxFile(next)) {
        const data = await previewXlsxFile(next);
        setPreview(data);
        setPhoneColumn(data.suggestedPhoneColumn || data.headers?.[0] || '');
        return;
      }
      setPreview({ headers: ['Phone No'], sampleRows: [], suggestedPhoneColumn: 'Phone No' });
      setPhoneColumn('Phone No');
    } catch (error) {
      resetUpload();
      toast.push(error.message || 'Could not preview file');
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
      setShowUpload(false);
      resetUpload();
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
  const pct = progress(active);

  return (
    <div>
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
            onClick={() => { setShowUpload(true); resetUpload(); }}
            disabled={busy || isProcessing}
          >
            <UploadCloud size={16} />
            {isProcessing ? 'Processing…' : 'Upload New List'}
          </Button>
        </div>
      </div>

      {/* Active version stats */}
      {loadingSummary ? (
        <p className="page-sub">Loading…</p>
      ) : active ? (
        <div style={{ marginBottom: 24 }}>
          {/* Status bar */}
          <div style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 14,
            padding: '16px 22px',
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 14,
          }}>
            <Ban size={20} color="var(--color-danger, #b42318)" />
            <div style={{ flex: 1 }}>
              <strong style={{ fontSize: '1rem' }}>
                Active Global DNC/Dead — Version v{active.version_number}
              </strong>
              <p className="page-sub" style={{ margin: '2px 0 0' }}>
                This list is applied to every scrub job across all campaigns.
                {active.activated_at && (
                  <> Last updated: {new Date(active.activated_at).toLocaleString()}.</>
                )}
              </p>
            </div>
            <StatusBadge value={active.status} />
          </div>

          {/* Stat cards */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 12,
            marginBottom: active.status === 'processing' ? 16 : 0,
          }}>
            <StatCard label="Unique Numbers" value={formatNumber(active.unique_numbers)} icon={Hash} accent="#1f6f5b" />
            <StatCard label="Total Rows" value={formatNumber(active.total_rows)} icon={Database} accent="#c45c26" />
            <StatCard label="Invalid" value={formatNumber(active.invalid_numbers)} icon={AlertTriangle} accent="#b42318" />
            <StatCard label="Duplicates" value={formatNumber(active.duplicate_numbers)} icon={Clock} accent="#b45309" />
          </div>

          {/* Progress bar if processing */}
          {active.status === 'processing' && (
            <div style={{ marginTop: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span className="page-sub">Processing…</span>
                <strong>{pct}%</strong>
              </div>
              <div style={{ height: 9, width: '100%', borderRadius: 999, background: 'var(--color-border)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${Math.max(pct, 2)}%`,
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
        <div style={{
          background: 'var(--color-surface)',
          border: '2px dashed var(--color-border)',
          borderRadius: 14,
          padding: '48px 24px',
          textAlign: 'center',
          marginBottom: 24,
        }}>
          <Ban size={40} style={{ opacity: 0.25, marginBottom: 12 }} />
          <p style={{ margin: 0, fontWeight: 600 }}>No Global DNC/Dead list uploaded yet.</p>
          <p className="page-sub" style={{ marginTop: 6 }}>
            Upload a CSV or XLSX file with phone numbers. This list will apply to all campaigns automatically.
          </p>
          <div style={{ marginTop: 16 }}>
            <Button type="button" onClick={() => { setShowUpload(true); resetUpload(); }}>
              <UploadCloud size={16} />
              Upload First List
            </Button>
          </div>
        </div>
      )}

      {/* Upload panel */}
      {showUpload && (
        <div className="card upload-panel" style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 16 }}>
            <div>
              <h3 style={{ margin: 0 }}>Upload Global DNC / Dead List</h3>
              <p className="page-sub" style={{ margin: '5px 0 0' }}>
                Upload a CSV or XLSX file and select the phone number column.
                This list will replace the current active list once processing completes.
              </p>
            </div>
            <button
              type="button"
              onClick={() => { if (!busy) { setShowUpload(false); resetUpload(); } }}
              disabled={busy}
              style={{ border: 0, background: 'transparent', cursor: busy ? 'not-allowed' : 'pointer', fontSize: '1.35rem', opacity: 0.7 }}
            >
              ×
            </button>
          </div>

          <FileDrop file={file} onFile={onFile} />

          {preview && (
            <div className="field" style={{ marginTop: 16 }}>
              <label>Phone number column</label>
              <select
                className="input"
                value={phoneColumn}
                onChange={(e) => setPhoneColumn(e.target.value)}
              >
                <option value="">Select phone column</option>
                {(preview.headers || []).map((header) => (
                  <option key={header} value={header}>{header}</option>
                ))}
              </select>
            </div>
          )}

          {preview?.sampleRows?.length > 0 && (
            <FilePreview headers={preview.headers} rows={preview.sampleRows} phoneColumn={phoneColumn} />
          )}

          {busy && uploadPercent > 0 && uploadPercent < 100 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span className="page-sub">Uploading…</span>
                <strong>{uploadPercent}%</strong>
              </div>
              <div style={{ height: 7, width: '100%', borderRadius: 999, background: 'var(--color-border)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${uploadPercent}%`, background: 'var(--color-primary)', transition: 'width .3s ease' }} />
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <Button
              type="button"
              onClick={uploadDnc}
              disabled={busy || !file || !phoneColumn}
            >
              {busy ? (
                <><UploadCloud size={16} /> Uploading…</>
              ) : (
                <><CheckCircle2 size={16} /> Upload DNC / Dead List</>
              )}
            </Button>
            {!busy && (
              <Button
                type="button"
                onClick={() => { setShowUpload(false); resetUpload(); }}
                style={{ background: 'transparent', color: 'inherit', border: '1px solid var(--color-border)' }}
              >
                Cancel
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Version history */}
      {recent.length > 0 && (
        <div className="card">
          <h3 style={{ margin: '0 0 16px' }}>Upload History</h3>
          <table className="dash-table">
            <thead>
              <tr>
                <th>Version</th>
                <th>Status</th>
                <th>Unique Numbers</th>
                <th>Total Rows</th>
                <th>Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((v) => (
                <tr key={v.id}>
                  <td><strong>v{v.version_number}</strong></td>
                  <td><StatusBadge value={v.status} /></td>
                  <td>{formatNumber(v.unique_numbers)}</td>
                  <td>{formatNumber(v.total_rows)}</td>
                  <td>{new Date(v.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
