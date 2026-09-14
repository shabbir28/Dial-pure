import { useEffect, useState, useRef, useMemo } from 'react';
import {
  Database,
  UploadCloud,
  ShieldCheck,
  ListX,
  CheckCircle2,
  History,
  FileText,
  FileSpreadsheet,
  AlertCircle,
  RefreshCw,
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

const LIST_TYPES = [
  {
    key: 'sales',
    title: 'Sales',
    button: 'Upload Sales',
    description:
      'Numbers already sold or converted. These are removed first during scrubbing.',
    icon: ShieldCheck,
  },
  {
    key: 'suppression',
    title: 'Suppression',
    button: 'Upload Suppression',
    description:
      'Additional internal suppression numbers that should not pass as clean.',
    icon: ListX,
  },
];

function emptyLists() {
  return {
    sales: null,
    suppression: null,
  };
}

function progress(version) {
  if (!version) return 0;

  const total = Number(version.total_rows || 0);
  const done = Number(version.processed_rows || 0);

  if (!total) return 0;

  return Math.min(100, Math.round((done / total) * 100));
}

export default function InternalSales() {
  const toast = useToast();

  const [campaigns, setCampaigns] = useState([]);
  const [campaignId, setCampaignId] = useState('');

  const [lists, setLists] = useState(emptyLists());
  const [history, setHistory] = useState([]);
  const [historyFilter, setHistoryFilter] = useState('all');
  const [loadingLists, setLoadingLists] = useState(false);

  const [selectedType, setSelectedType] = useState(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [phoneColumn, setPhoneColumn] = useState('');
  const [uploadModalOpen, setUploadModalOpen] = useState(false);

  const [busy, setBusy] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);

  const fileInputRef = useRef(null);
  const pendingTypeRef = useRef(null);

  async function loadCampaigns() {
    const res = await api.get('/campaigns', {
      params: { pageSize: 100 },
    });

    const items = (res.data.items || []).filter(
      (item) => item.status !== 'archived'
    );

    setCampaigns(items);

    setCampaignId((current) => {
      if (current && items.some((item) => item.id === current)) {
        return current;
      }

      const active = items.find((item) => item.status === 'active');
      return active?.id || items[0]?.id || '';
    });
  }

  async function loadLists(id = campaignId) {
    if (!id) {
      setLists(emptyLists());
      setHistory([]);
      return;
    }

    setLoadingLists(true);

    try {
      const res = await api.get(`/campaigns/${id}/internal-lists`);
      const data = res.data || {};

      setLists({
        sales: data.sales || null,
        suppression: data.suppression || null,
      });
      setHistory(data.history || []);
    } catch (error) {
      if (error?.response?.status === 404) {
        setLists(emptyLists());
        setHistory([]);
        return;
      }
      throw error;
    } finally {
      setLoadingLists(false);
    }
  }

  useEffect(() => {
    loadCampaigns().catch((error) => {
      toast.push(error.message || 'Could not load campaigns');
    });
  }, []);

  useEffect(() => {
    closeUpload();

    if (!campaignId) {
      setLists(emptyLists());
      setHistory([]);
      return;
    }

    loadLists(campaignId).catch((error) => {
      toast.push(error.message || 'Could not load internal lists');
    });
  }, [campaignId]);

  useEffect(() => {
    if (!campaignId) return undefined;

    const timer = setInterval(() => {
      loadLists(campaignId).catch(() => {});
    }, 3000);

    return () => clearInterval(timer);
  }, [campaignId]);

  function resetUpload() {
    setFile(null);
    setPreview(null);
    setPhoneColumn('');
    setUploadPercent(0);
  }

  function triggerUpload(type) {
    if (busy) return;
    pendingTypeRef.current = type;
    setSelectedType(type);
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

      setPreview({
        headers: ['Phone No'],
        sampleRows: [],
        suggestedPhoneColumn: 'Phone No',
      });
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
    setSelectedType(null);
    resetUpload();
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  async function uploadList() {
    if (!campaignId || !selectedType || !file || !phoneColumn) return;

    setBusy(true);
    setUploadPercent(0);

    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('phoneColumn', phoneColumn);

      await api.post(
        `/campaigns/${campaignId}/internal-lists/${selectedType}`,
        fd,
        {
          onUploadProgress: (event) => {
            if (!event.total) return;
            setUploadPercent(
              Math.min(100, Math.round((event.loaded / event.total) * 100))
            );
          },
        }
      );

      const config = LIST_TYPES.find((item) => item.key === selectedType);
      toast.push(
        `${config?.title || 'Internal list'} uploaded. Processing has started.`
      );

      closeUpload();

      setTimeout(() => {
        loadLists(campaignId).catch(() => {});
      }, 500);
    } catch (error) {
      toast.push(error.message || 'Internal list upload failed');
    } finally {
      setBusy(false);
    }
  }

  const selectedConfig = LIST_TYPES.find((item) => item.key === selectedType);

  const internalLogs = useMemo(() => {
    return (history || []).filter(
      (item) => item.list_type === 'sales' || item.list_type === 'suppression'
    );
  }, [history]);

  const filteredHistory = useMemo(() => {
    if (historyFilter === 'all') return internalLogs;
    return internalLogs.filter((item) => item.list_type === historyFilter);
  }, [internalLogs, historyFilter]);

  return (
    <div>
      {/* Hidden file input for instant file selection */}
      <input
        type="file"
        ref={fileInputRef}
        accept=".csv,.xlsx,.xls"
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
      />

      <div className="page-header">
        <div>
          <h2 className="page-title">Internal Suppression Lists</h2>
          <p className="page-sub">
            Manage Sales and Suppression lists separately for each campaign.
            DNC / Dead numbers are managed globally in the{' '}
            <a href="/internal-dnc" style={{ color: 'var(--color-primary)' }}>
              Internal DNC / Dead
            </a>{' '}
            module.
          </p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Campaign</label>
          <select
            className="input"
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
          >
            <option value="">Select campaign</option>
            {campaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.campaign_code} · {campaign.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {campaignId && (
        <>
          {/* Top 2 Cards: Sales & Suppression */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: 16,
            }}
          >
            {LIST_TYPES.map((config) => {
              const Icon = config.icon;
              const version = lists[config.key];
              const percent = progress(version);

              const queued =
                version?.status === 'processing' &&
                Number(version?.total_rows || 0) === 0 &&
                Number(version?.processed_rows || 0) === 0;

              const processing = version?.status === 'processing' && !queued;

              return (
                <div
                  key={config.key}
                  className="card"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    minHeight: 330,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      marginBottom: 14,
                    }}
                  >
                    <div
                      style={{
                        width: 42,
                        height: 42,
                        borderRadius: 10,
                        display: 'grid',
                        placeItems: 'center',
                        background:
                          'var(--color-surface-soft, var(--color-border))',
                      }}
                    >
                      <Icon size={21} />
                    </div>

                    <div>
                      <h3 style={{ margin: 0, fontSize: '1.05rem' }}>
                        {config.title}
                      </h3>
                      <div className="page-sub" style={{ marginTop: 3 }}>
                        {version
                          ? `Version v${version.version_number}`
                          : 'No active list'}
                      </div>
                    </div>
                  </div>

                  <p
                    className="page-sub"
                    style={{ minHeight: 42, marginTop: 0 }}
                  >
                    {config.description}
                  </p>

                  {loadingLists && !version ? (
                    <div className="page-sub" style={{ marginTop: 12 }}>
                      Loading…
                    </div>
                  ) : version ? (
                    <>
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(2, minmax(0,1fr))',
                          gap: 12,
                          marginTop: 8,
                        }}
                      >
                        <div>
                          <span className="page-sub">Status</span>
                          <div style={{ marginTop: 4 }}>
                            {queued ? (
                              <strong>Queued</strong>
                            ) : processing ? (
                              <strong>Processing</strong>
                            ) : (
                              <StatusBadge value={version.status} />
                            )}
                          </div>
                        </div>

                        <div>
                          <span className="page-sub">Unique Numbers</span>
                          <div style={{ marginTop: 4, fontSize: '1.15rem' }}>
                            <strong>
                              {formatNumber(version.unique_numbers)}
                            </strong>
                          </div>
                        </div>

                        <div>
                          <span className="page-sub">Total Rows</span>
                          <div>
                            <strong>
                              {formatNumber(version.total_rows)}
                            </strong>
                          </div>
                        </div>

                        <div>
                          <span className="page-sub">Duplicates</span>
                          <div>
                            <strong>
                              {formatNumber(version.duplicate_numbers)}
                            </strong>
                          </div>
                        </div>

                        <div>
                          <span className="page-sub">Invalid</span>
                          <div>
                            <strong>
                              {formatNumber(version.invalid_numbers)}
                            </strong>
                          </div>
                        </div>
                      </div>

                      {processing && (
                        <div style={{ marginTop: 16 }}>
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              marginBottom: 6,
                            }}
                          >
                            <span className="page-sub">Processing</span>
                            <strong>{percent}%</strong>
                          </div>

                          <div
                            style={{
                              height: 9,
                              width: '100%',
                              borderRadius: 999,
                              background: 'var(--color-border)',
                              overflow: 'hidden',
                            }}
                          >
                            <div
                              style={{
                                height: '100%',
                                width: `${Math.max(percent, 2)}%`,
                                background: 'var(--color-success)',
                                transition: 'width .3s ease',
                              }}
                            />
                          </div>

                          <div
                            className="page-sub"
                            style={{ marginTop: 6, fontSize: '.8rem' }}
                          >
                            {formatNumber(version.processed_rows)} /{' '}
                            {formatNumber(version.total_rows)} rows
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div
                      style={{
                        flex: 1,
                        display: 'grid',
                        placeItems: 'center',
                        textAlign: 'center',
                        minHeight: 120,
                      }}
                    >
                      <div>
                        <Database size={28} style={{ opacity: 0.35 }} />
                        <p className="page-sub" style={{ marginBottom: 0 }}>
                          No {config.title} list uploaded yet.
                        </p>
                      </div>
                    </div>
                  )}

                  <div style={{ marginTop: 'auto', paddingTop: 18 }}>
                    <Button
                      type="button"
                      onClick={() => triggerUpload(config.key)}
                      disabled={busy || version?.status === 'processing'}
                    >
                      <UploadCloud size={16} />
                      {version?.status === 'processing'
                        ? 'Processing…'
                        : config.button}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

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
                    background:
                      'var(--color-surface-soft, rgba(255,255,255,0.05))',
                    border: '1px solid var(--color-border)',
                    display: 'grid',
                    placeItems: 'center',
                    color: 'var(--color-primary)',
                  }}
                >
                  <History size={18} />
                </div>
                <div>
                  <h3
                    style={{
                      margin: 0,
                      fontSize: '1.05rem',
                      fontWeight: 700,
                    }}
                  >
                    Sales & Suppression Upload Logs
                  </h3>
                  <p
                    className="page-sub"
                    style={{ margin: '2px 0 0', fontSize: '0.78rem' }}
                  >
                    History of files uploaded under Upload Sales and Upload Suppression for this campaign.
                  </p>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {['all', 'sales', 'suppression'].map((filterKey) => {
                  const count =
                    filterKey === 'all'
                      ? internalLogs.length
                      : internalLogs.filter((h) => h.list_type === filterKey).length;
                  const isActive = historyFilter === filterKey;
                  return (
                    <button
                      key={filterKey}
                      type="button"
                      onClick={() => setHistoryFilter(filterKey)}
                      style={{
                        border: '1px solid',
                        borderColor: isActive
                          ? 'var(--color-primary)'
                          : 'var(--color-border)',
                        background: isActive
                          ? 'var(--color-primary)'
                          : 'transparent',
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
              <div
                style={{
                  padding: '40px 20px',
                  textAlign: 'center',
                  color: 'var(--color-muted)',
                }}
              >
                <FileSpreadsheet
                  size={32}
                  style={{ opacity: 0.35, marginBottom: 8 }}
                />
                <p style={{ margin: 0, fontSize: '0.88rem' }}>
                  No upload logs found for this campaign yet.
                </p>
                <p
                  style={{
                    margin: '4px 0 0',
                    fontSize: '0.78rem',
                    opacity: 0.7,
                  }}
                >
                  Click "Upload Sales" or "Upload Suppression" above to upload a list.
                </p>
              </div>
            ) : (
              <div className="table-wrap" style={{ overflowX: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Uploaded</th>
                      <th>Type</th>
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
                        <td
                          style={{
                            fontSize: '0.82rem',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {formatDate(item.created_at)}
                        </td>
                        <td>
                          <span
                            style={{
                              fontSize: '0.72rem',
                              fontWeight: 700,
                              textTransform: 'uppercase',
                              letterSpacing: '0.04em',
                              padding: '3px 8px',
                              borderRadius: 6,
                              background:
                                item.list_type === 'sales'
                                  ? '#7c3aed20'
                                  : '#57534e20',
                              color:
                                item.list_type === 'sales'
                                  ? '#a78bfa'
                                  : '#a8a29a',
                              border:
                                item.list_type === 'sales'
                                  ? '1px solid #7c3aed40'
                                  : '1px solid #57534e40',
                            }}
                          >
                            {item.list_type === 'sales'
                              ? 'Sales'
                              : item.list_type === 'suppression'
                              ? 'Suppression'
                              : item.list_type}
                          </span>
                        </td>
                        <td>
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                            }}
                          >
                            <FileText
                              size={14}
                              style={{ opacity: 0.6, flexShrink: 0 }}
                            />
                            <span
                              style={{ fontWeight: 600, fontSize: '0.84rem' }}
                              title={item.original_filename}
                            >
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
                            color:
                              item.unique_numbers > 0
                                ? 'var(--color-primary)'
                                : 'inherit',
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
                          {item.first_name
                            ? `${item.first_name} ${item.last_name || ''}`
                            : 'System'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Upload Confirmation & Preview Modal */}
      {uploadModalOpen && file && (
        <Modal
          title={
            selectedType === 'sales'
              ? 'Upload Sales List'
              : 'Upload Suppression List'
          }
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
                <FileSpreadsheet
                  size={24}
                  style={{ color: 'var(--color-primary)' }}
                />
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>
                    {file.name}
                  </div>
                  <div style={{ fontSize: '0.76rem', opacity: 0.7 }}>
                    {formatBytes(file.size)} · {preview?.headers?.length || 0}{' '}
                    columns detected
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
                <div
                  style={{
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    opacity: 0.8,
                    marginBottom: 6,
                  }}
                >
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
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginBottom: 6,
                  }}
                >
                  <span
                    className="page-sub"
                    style={{ fontSize: '0.82rem' }}
                  >
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
                onClick={uploadList}
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
                    {selectedConfig?.button || 'Upload'}
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
