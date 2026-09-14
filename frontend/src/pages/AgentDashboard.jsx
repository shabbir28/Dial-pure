import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  UploadCloud, Search, CheckCircle2, AlertTriangle,
  FileSpreadsheet, ExternalLink, Loader2
} from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import StatusBadge from '../components/StatusBadge';
import { formatDate, formatNumber } from '../utils/format';
import { MAX_UPLOAD_BYTES, isCsvFile, isXlsxFile, previewCsvFile, previewXlsxFile } from '../utils/upload';
import './AgentDashboard.css';

export default function AgentDashboard() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [dashboardData, setDashboardData] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [campaignId, setCampaignId] = useState('');
  const [loading, setLoading] = useState(true);

  // File upload state
  const fileInputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [phoneColumn, setPhoneColumn] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);

  // Phone lookup state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchResult, setSearchResult] = useState(null);
  const [hasSearched, setHasSearched] = useState(false);

  useEffect(() => {
    async function loadData() {
      try {
        const [dashRes, campRes] = await Promise.allSettled([
          api.get('/agent/dashboard'),
          api.get('/campaigns', { params: { pageSize: 100, status: 'active' } }),
        ]);

        let loadedCampaigns = [];
        if (campRes.status === 'fulfilled' && campRes.value.data?.items?.length) {
          loadedCampaigns = campRes.value.data.items;
        }

        if (dashRes.status === 'fulfilled') {
          setDashboardData(dashRes.value.data);
          if (!loadedCampaigns.length && dashRes.value.data.campaigns?.length) {
            loadedCampaigns = dashRes.value.data.campaigns;
          }
        }

        // Deduplicate campaigns
        const campMap = new Map();
        loadedCampaigns.forEach((c) => campMap.set(c.id, c));
        if (dashRes.status === 'fulfilled' && dashRes.value.data?.campaigns) {
          dashRes.value.data.campaigns.forEach((c) => {
            if (!campMap.has(c.id)) campMap.set(c.id, c);
          });
        }
        setCampaigns(Array.from(campMap.values()));
      } catch (err) {
        console.error('Failed to load agent dashboard:', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  async function handleFile(selectedFile) {
    if (!selectedFile) return;
    if (selectedFile.size > MAX_UPLOAD_BYTES) {
      toast.push('File is larger than the 500 MB limit.');
      return;
    }
    setFile(selectedFile);
    try {
      if (isCsvFile(selectedFile)) {
        const data = await previewCsvFile(selectedFile);
        setPreview(data);
        setPhoneColumn(data.suggestedPhoneColumn || data.headers?.[0] || '');
        return;
      }
      if (isXlsxFile(selectedFile)) {
        const data = await previewXlsxFile(selectedFile);
        setPreview(data);
        setPhoneColumn(data.suggestedPhoneColumn || data.headers?.[0] || '');
        return;
      }
      setPreview({ headers: ['Phone No'], sampleRows: [], suggestedPhoneColumn: 'Phone No' });
      setPhoneColumn('Phone No');
    } catch (err) {
      toast.push(`Could not parse file preview: ${err.message}`);
    }
  }

  function onDrop(e) {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files?.[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  }

  async function startScrub() {
    if (!campaignId) {
      toast.push('Please select a campaign first.');
      return;
    }
    if (!file) {
      toast.push('Please upload a CSV or XLSX file to scrub.');
      return;
    }
    if (!phoneColumn) {
      toast.push('Please select the phone number column.');
      return;
    }

    setBusy(true);
    setUploadPercent(0);

    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('campaignId', campaignId);
      fd.append('phoneColumn', phoneColumn);

      const res = await api.post('/scrub-jobs', fd, {
        onUploadProgress: (event) => {
          if (!event.total) return;
          setUploadPercent(Math.min(99, Math.round((event.loaded / event.total) * 100)));
        },
      });

      setUploadPercent(100);

      const prior = res.data.priorSameFile?.[0];
      toast.push(
        prior
          ? {
              title: 'Same file detected',
              description: `This file was previously scrubbed as ${prior.job_number}.`,
            }
          : {
              title: 'Scrub Job Created',
              description: `Job ${res.data.jobNumber || res.data.id} is queued for scrubbing.`,
            }
      );

      navigate(`/jobs/${res.data.id}`);
    } catch (err) {
      toast.push(err.response?.data?.error?.message || err.message || 'Failed to start scrub job');
    } finally {
      setBusy(false);
      setUploadPercent(0);
    }
  }

  async function handleSearch(e) {
    e?.preventDefault();
    const q = searchQuery.trim();
    if (!q) {
      toast.push('Enter a phone number to search.');
      return;
    }

    setSearchBusy(true);
    setSearchResult(null);
    setHasSearched(false);

    try {
      const res = await api.get('/lookup/phone', { params: { q } });
      setSearchResult(res.data);
      setHasSearched(true);
    } catch (err) {
      toast.push(err.response?.data?.error?.message || err.message || 'Phone lookup failed');
    } finally {
      setSearchBusy(false);
    }
  }

  const selectedCampaign = campaigns.find((c) => c.id === campaignId);
  const recentJobs = dashboardData?.recentJobs || [];

  return (
    <div className="agent-dash-container">
      {/* Main heading */}
      <div className="agent-header">
        <h1>Data Scrubber</h1>
        <p>Upload your data file to start scrubbing</p>
      </div>

      {/* CARD 1: Create Scrubbing Job */}
      <div className="agent-card">
        <div className="agent-card__header">
          <h2 className="agent-card__title">Create Scrubbing Job</h2>
          <p className="agent-card__desc">
            Select a campaign and upload your CSV or Excel file to scrub phone numbers
          </p>
        </div>

        {/* Campaign dropdown */}
        <div className="agent-field">
          <label htmlFor="agent-campaign-select">Campaign</label>
          <select
            id="agent-campaign-select"
            className="agent-select"
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
          >
            <option value="">Select a campaign</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.campaign_code ? `${c.campaign_code} · ${c.name}` : c.name}
              </option>
            ))}
          </select>
          {selectedCampaign && (
            <span className="agent-formats-hint">
              {formatNumber(selectedCampaign.active_unique_numbers || selectedCampaign.unique_numbers || 0)} numbers on active campaign list
            </span>
          )}
        </div>

        {/* Upload File Input matching screenshot style */}
        <div className="agent-field">
          <label>Upload File</label>
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: 'none' }}
            accept=".csv,.xlsx,.xls"
            onChange={(e) => {
              if (e.target.files?.[0]) handleFile(e.target.files[0]);
            }}
          />
          <div
            className={`agent-file-box ${isDragOver ? 'dragover' : ''}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={onDrop}
          >
            <button type="button" className="agent-file-btn" onClick={(e) => {
              e.stopPropagation();
              fileInputRef.current?.click();
            }}>
              <FileSpreadsheet size={15} /> Choose file
            </button>
            <span className={`agent-file-label ${file ? 'has-file' : ''}`}>
              {file ? `${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)` : 'No file chosen'}
            </span>
          </div>
          <span className="agent-formats-hint">Supported formats: CSV, XLSX</span>

          {/* File Column Preview and Auto-Detection */}
          {file && preview && (
            <div className="agent-file-meta">
              <span>Detected headers: <strong>{preview.headers?.length || 0}</strong></span>
              {preview.sampleRows?.length > 0 && (
                <span>Sample preview: <strong>{preview.sampleRows.length} rows</strong></span>
              )}
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                <span className="agent-meta-chip">Phone Column:</span>
                {preview.headers?.length > 1 ? (
                  <select
                    className="agent-col-select"
                    value={phoneColumn}
                    onChange={(e) => setPhoneColumn(e.target.value)}
                  >
                    {preview.headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                ) : (
                  <strong>{phoneColumn || 'Phone No'}</strong>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Start Scrubbing Button */}
        <button
          type="button"
          className="agent-start-btn"
          disabled={busy || !file || !campaignId}
          onClick={startScrub}
        >
          {busy ? (
            <>
              <Loader2 size={17} className="spin" /> Scrubbing...
            </>
          ) : (
            <>
              <UploadCloud size={17} /> Start Scrubbing
            </>
          )}
        </button>

        {/* Upload Progress Bar */}
        {busy && (
          <div className="agent-progress-wrap">
            <div className="agent-progress-bar">
              <div
                className="agent-progress-fill"
                style={{ width: `${uploadPercent}%` }}
              />
            </div>
            <div className="agent-progress-text">
              <span>Uploading & preparing scrub job...</span>
              <span>{uploadPercent}%</span>
            </div>
          </div>
        )}
      </div>

      {/* CARD 2: Search Phone Number */}
      <div className="agent-card">
        <div className="agent-card__header">
          <h2 className="agent-card__title">Search Phone Number</h2>
          <p className="agent-card__desc">
            Search for a phone number to see which campaigns it belongs to
          </p>
        </div>

        <form onSubmit={handleSearch} className="agent-search-row">
          <input
            type="text"
            className="agent-search-input"
            placeholder="Enter phone number (e.g., +1234567890 or 234-567-8900)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <button
            type="submit"
            className="agent-search-btn"
            disabled={searchBusy || !searchQuery.trim()}
          >
            {searchBusy ? (
              <>
                <Loader2 size={15} className="spin" /> Searching
              </>
            ) : (
              <>
                <Search size={15} /> Search
              </>
            )}
          </button>
        </form>

        {/* Inline Search Result Display */}
        {searchResult && (
          <div className="agent-search-results">
            {searchResult.campaigns?.length > 0 ? (
              <div className="agent-result-box matched">
                <div className="agent-result-badge">
                  <AlertTriangle size={17} /> Matched in {searchResult.campaigns.length} Campaign List(s)
                </div>
                <p className="agent-result-desc">
                  This phone number is present on the following campaign master/suppression lists:
                </p>
                <div style={{ overflowX: 'auto' }}>
                  <table className="agent-result-table">
                    <thead>
                      <tr>
                        <th>Campaign</th>
                        <th>Version</th>
                        <th>Status</th>
                        <th>Source Row</th>
                        <th>Activated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {searchResult.campaigns.map((c, i) => (
                        <tr key={`${c.version_id || i}-${c.source_row_number}`}>
                          <td><strong>{c.campaign_name}</strong> {c.campaign_code ? `(${c.campaign_code})` : ''}</td>
                          <td>v{c.version_number}</td>
                          <td><StatusBadge value={c.version_status} /></td>
                          <td>{c.source_row_number ? `#${c.source_row_number}` : '—'}</td>
                          <td>{c.activated_at ? formatDate(c.activated_at) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : hasSearched ? (
              <div className="agent-result-box clean">
                <div className="agent-result-badge">
                  <CheckCircle2 size={17} /> Clean Number — Not Found in Any Campaign List
                </div>
                <p className="agent-result-desc">
                  This phone number does not exist in any campaign suppression or sales list and is safe to call.
                </p>
              </div>
            ) : null}

            {/* Prior uploads if any */}
            {searchResult.uploads?.length > 0 && (
              <div style={{ marginTop: '1rem' }}>
                <p style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--color-muted)', marginBottom: '0.4rem' }}>
                  Prior Agent Upload History ({searchResult.uploads.length}):
                </p>
                <div style={{ overflowX: 'auto' }}>
                  <table className="agent-result-table">
                    <thead>
                      <tr>
                        <th>Job</th>
                        <th>Agent</th>
                        <th>Campaign</th>
                        <th>File</th>
                        <th>Uploaded</th>
                      </tr>
                    </thead>
                    <tbody>
                      {searchResult.uploads.slice(0, 5).map((u, i) => (
                        <tr key={i}>
                          <td><Link to={`/jobs/${u.jobId}`} className="agent-job-link">{u.jobNumber}</Link></td>
                          <td>{u.agent?.name || u.agent?.email || '—'}</td>
                          <td>{u.campaignName}</td>
                          <td>{u.filename}</td>
                          <td>{u.uploadedAt ? formatDate(u.uploadedAt) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* SECTION 3: Recent Scrub Jobs */}
      {recentJobs.length > 0 && (
        <div className="agent-card">
          <div className="agent-recent-header">
            <h3>Recent Scrub Jobs</h3>
            <Link to="/jobs" style={{ fontSize: '0.82rem', color: '#4f46e5', fontWeight: 600 }}>
              View all jobs →
            </Link>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="agent-recent-table">
              <thead>
                <tr>
                  <th>Job #</th>
                  <th>Campaign</th>
                  <th>File</th>
                  <th>Total Rows</th>
                  <th>Clean</th>
                  <th>Matched</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {recentJobs.map((j) => (
                  <tr key={j.id}>
                    <td>
                      <Link to={`/jobs/${j.id}`} className="agent-job-link">
                        {j.job_number}
                      </Link>
                    </td>
                    <td>{j.campaign_name}</td>
                    <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={j.original_filename}>
                      {j.original_filename || '—'}
                    </td>
                    <td>{formatNumber(j.total_rows)}</td>
                    <td className="agent-count-clean">{formatNumber(j.clean_count)}</td>
                    <td className="agent-count-matched">{formatNumber(j.matched_count)}</td>
                    <td><StatusBadge value={j.status} /></td>
                    <td>
                      <Link
                        to={`/jobs/${j.id}`}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.3rem',
                          fontSize: '0.8rem',
                          color: 'var(--color-primary)',
                          fontWeight: 600,
                        }}
                      >
                        <ExternalLink size={13} /> View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
