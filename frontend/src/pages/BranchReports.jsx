import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Download,
  Eye,
  FileSpreadsheet,
  UsersRound
} from 'lucide-react';

import api from '../services/api';
import Button from '../components/Button';
import StatusBadge from '../components/StatusBadge';
import { useToast } from '../components/Toast';
import { formatDate, formatNumber } from '../utils/format';

function exportLabel(type) {
  const labels = {
    clean: 'Clean',
    matched: 'Internal Match',
    external_matched: 'Client Match',
    duplicate: 'Duplicates',
    invalid: 'Invalid',
    complete: 'Complete',
  };

  return labels[type] || type;
}

export default function BranchReports() {
  const toast = useToast();

  const [users, setUsers] = useState([]);
  const [userId, setUserId] = useState('');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState('');

  async function loadUsers() {
    const res = await api.get('/users', {
      params: {
        role: 'agent',
        pageSize: 100
      }
    });

    const items = (res.data.items || []).filter(
      (u) => u.role === 'agent'
    );

    setUsers(items);

    setUserId((current) => {
      if (current && items.some((u) => u.id === current)) {
        return current;
      }

      const active = items.find((u) => u.status === 'active');
      return active?.id || items[0]?.id || '';
    });
  }

  async function loadReport(id = userId) {
    if (!id) {
      setReport(null);
      return;
    }

    setLoading(true);

    try {
      const res = await api.get(`/branch-reports/${id}`);
      setReport(res.data);
    } catch (error) {
      toast.push(error.message || 'Could not load branch report');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers().catch((error) => {
      toast.push(error.message || 'Could not load branches');
    });
  }, []);

  useEffect(() => {
    if (userId) {
      loadReport(userId);
    } else {
      setReport(null);
    }
  }, [userId]);

  async function downloadExport(exp) {
    setDownloading(exp.id);

    try {
      const blob = await api.get(
        `/exports/${exp.id}/download`,
        { responseType: 'blob' }
      );

      const userName = report?.user
        ? `${report.user.first_name}_${report.user.last_name}`
            .replace(/[^a-zA-Z0-9_-]+/g, '_')
        : 'branch';

      const filename =
        `${userName}_${exp.export_type}.csv`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');

      a.href = url;
      a.download = filename;

      document.body.appendChild(a);
      a.click();
      a.remove();

      URL.revokeObjectURL(url);

      await loadReport(userId);
    } catch (error) {
      toast.push(error.message || 'Download failed');
    } finally {
      setDownloading('');
    }
  }

  const summary = report?.summary || {};

  const selectedUser = useMemo(
    () => users.find((u) => u.id === userId),
    [users, userId]
  );

  const statCards = [
    ['Files Uploaded', summary.files_uploaded],
    ['Total Rows', summary.total_rows],
    ['Unique Numbers', summary.unique_numbers],
    ['Clean', summary.clean_count],
    ['Internal Match', summary.matched_count],
    ['Client Match', summary.external_match_count],
    ['Duplicates', summary.duplicate_count],
    ['Invalid', summary.invalid_count],
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 className="page-title">Branch Reports</h2>
          <p className="page-sub">
            Review every branch upload, result count and generated download.
          </p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'end',
            gap: 12
          }}
        >
          <div
            className="field"
            style={{
              flex: 1,
              marginBottom: 0
            }}
          >
            <label>Branch / User</label>

            <select
              className="input"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            >
              <option value="">Select branch</option>

              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.user_code} · {u.first_name} {u.last_name} · {u.email}
                </option>
              ))}
            </select>
          </div>

          <Button
            type="button"
            variant="secondary"
            disabled={!userId || loading}
            onClick={() => loadReport()}
          >
            Refresh
          </Button>
        </div>
      </div>

      {loading && !report && (
        <div className="card">
          Loading branch report...
        </div>
      )}

      {report && (
        <>
          <div
            className="card"
            style={{
              marginBottom: 16,
              display: 'flex',
              alignItems: 'center',
              gap: 14
            }}
          >
            <UsersRound size={26} />

            <div>
              <h3 style={{ margin: 0 }}>
                {report.user.first_name} {report.user.last_name}
              </h3>

              <p
                className="page-sub"
                style={{ margin: '3px 0 0' }}
              >
                {report.user.user_code} · {report.user.email} ·{' '}
                {report.user.status}
              </p>
            </div>
          </div>

          <div
            className="job-stats"
            style={{
              marginBottom: 16
            }}
          >
            {statCards.map(([label, value]) => (
              <article key={label}>
                <span>{label}</span>
                <strong>{formatNumber(value || 0)}</strong>
              </article>
            ))}
          </div>

          <div className="card table-wrap">
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                marginBottom: 14
              }}
            >
              <FileSpreadsheet size={20} />
              <h3 style={{ margin: 0 }}>Uploaded Files</h3>
            </div>

            <table className="data-table">
              <thead>
                <tr>
                  <th>Uploaded</th>
                  <th>Job</th>
                  <th>Campaign</th>
                  <th>File</th>
                  <th>Total</th>
                  <th>Unique</th>
                  <th>Clean</th>
                  <th>Internal</th>
                  <th>Client</th>
                  <th>Dup</th>
                  <th>Invalid</th>
                  <th>Status</th>
                  <th>Downloads</th>
                </tr>
              </thead>

              <tbody>
                {(report.jobs || []).length === 0 ? (
                  <tr>
                    <td
                      colSpan={13}
                      style={{
                        textAlign: 'center',
                        color: 'var(--color-muted)'
                      }}
                    >
                      No files uploaded by this branch yet.
                    </td>
                  </tr>
                ) : (
                  report.jobs.map((job) => (
                    <tr key={job.id}>
                      <td>{formatDate(job.created_at)}</td>

                      <td>
                        <Link to={`/jobs/${job.id}`}>
                          {job.job_number}
                        </Link>
                      </td>

                      <td>
                        {job.campaign_name} v{job.version_number}
                      </td>

                      <td>{job.original_filename}</td>

                      <td>{formatNumber(job.total_rows)}</td>
                      <td>{formatNumber(job.unique_numbers)}</td>
                      <td>{formatNumber(job.clean_count)}</td>
                      <td>{formatNumber(job.matched_count)}</td>

                      <td>
                        {formatNumber(job.external_match_count)}
                      </td>

                      <td>{formatNumber(job.duplicate_count)}</td>
                      <td>{formatNumber(job.invalid_count)}</td>

                      <td>
                        <StatusBadge value={job.status} />
                      </td>

                      <td>
                        <div
                          className="row-actions"
                          style={{
                            flexWrap: 'wrap',
                            minWidth: 220
                          }}
                        >
                          <Link
                            className="btn btn--secondary btn--sm"
                            to={`/jobs/${job.id}`}
                            title="Open job"
                          >
                            <Eye size={13} />
                            View
                          </Link>

                          {(job.exports || []).map((exp) => (
                            <Button
                              key={exp.id}
                              type="button"
                              variant={
                                exp.export_type === 'clean'
                                  ? 'primary'
                                  : 'secondary'
                              }
                              size="sm"
                              disabled={downloading === exp.id}
                              onClick={() => downloadExport(exp)}
                              title={`${exportLabel(exp.export_type)} · ${formatNumber(exp.row_count)} rows`}
                            >
                              <Download size={12} />

                              {downloading === exp.id
                                ? '...'
                                : exportLabel(exp.export_type)}
                            </Button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!loading && users.length === 0 && (
        <div className="card">
          No agent/branch accounts found.
        </div>
      )}

      {!loading && users.length > 0 && !selectedUser && (
        <div className="card">
          Select a branch to view its report.
        </div>
      )}
    </div>
  );
}
