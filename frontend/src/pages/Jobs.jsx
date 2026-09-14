import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, RotateCcw, XCircle } from 'lucide-react';
import api from '../services/api';
import { duration, formatDate, formatNumber } from '../utils/format';
import StatusBadge from '../components/StatusBadge';
import Button from '../components/Button';
import { useToast } from '../components/Toast';

export default function Jobs() {
  const toast = useToast();

  const [items, setItems] = useState([]);
  const [filters, setFilters] = useState({
    jobId: '',
    status: '',
    filename: ''
  });

  const [working, setWorking] = useState('');

  async function load() {
    const res = await api.get('/scrub-jobs', {
      params: {
        ...filters,
        pageSize: 50
      }
    });

    setItems(res.data.items);
  }

  useEffect(() => {
    load();

    const timer = setInterval(() => {
      load().catch(() => {});
    }, 5000);

    return () => clearInterval(timer);
  }, []);

  async function cancelJob(job) {
    const ok = window.confirm(
      `Cancel ${job.job_number}?\n\nThe current processing will stop. You can restart it later.`
    );

    if (!ok) return;

    setWorking(`cancel:${job.id}`);

    try {
      await api.post(`/scrub-jobs/${job.id}/cancel`);

      toast.push(`${job.job_number} cancelled`);
      await load();
    } catch (error) {
      toast.push(error.message || 'Could not cancel job');
    } finally {
      setWorking('');
    }
  }

  async function restartJob(job) {
    const ok = window.confirm(
      `Restart ${job.job_number}?\n\nExisting partial processing will be cleared and the original uploaded file will be scrubbed again from the beginning.`
    );

    if (!ok) return;

    setWorking(`restart:${job.id}`);

    try {
      await api.post(`/scrub-jobs/${job.id}/restart`);

      toast.push(`${job.job_number} queued for restart`);
      await load();
    } catch (error) {
      toast.push(error.message || 'Could not restart job');
    } finally {
      setWorking('');
    }
  }

  const runningStatuses = [
    'queued',
    'validating',
    'processing',
    'generating_exports'
  ];

  return (
    <div>
      <h2 className="page-title">Scrub jobs</h2>

      <p className="page-sub">
        Every upload is a pinned, auditable job against one campaign version.
      </p>

      <div className="filters">
        <input
          className="input"
          placeholder="Job ID"
          value={filters.jobId}
          onChange={(e) =>
            setFilters({
              ...filters,
              jobId: e.target.value
            })
          }
        />

        <input
          className="input"
          placeholder="Filename"
          value={filters.filename}
          onChange={(e) =>
            setFilters({
              ...filters,
              filename: e.target.value
            })
          }
        />

        <select
          className="input"
          value={filters.status}
          onChange={(e) =>
            setFilters({
              ...filters,
              status: e.target.value
            })
          }
        >
          <option value="">All statuses</option>

          {[
            'queued',
            'validating',
            'processing',
            'generating_exports',
            'completed',
            'failed',
            'cancelled'
          ].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <Button
          type="button"
          variant="secondary"
          onClick={load}
        >
          Filter
        </Button>
      </div>

      <div className="card table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Job</th>
              <th>Agent</th>
              <th>Campaign</th>
              <th>File</th>
              <th>Uploaded</th>
              <th>Total</th>
              <th>Clean</th>
              <th>Match</th>
              <th>Invalid</th>
              <th>Dup</th>
              <th>Status</th>
              <th>Time</th>
              <th>Actions</th>
            </tr>
          </thead>

          <tbody>
            {items.map((j) => {
              const running =
                runningStatuses.includes(j.status);

              const canRestart =
                j.status !== 'completed';

              const cancelling =
                working === `cancel:${j.id}`;

              const restarting =
                working === `restart:${j.id}`;

              return (
                <tr key={j.id}>
                  <td>
                    <Link to={`/jobs/${j.id}`}>
                      {j.job_number}
                    </Link>
                  </td>

                  <td>
                    {j.first_name} {j.last_name}
                  </td>

                  <td>
                    {j.campaign_name} v{j.version_number}
                  </td>

                  <td>{j.original_filename}</td>

                  <td>{formatDate(j.created_at)}</td>

                  <td>
                    {formatNumber(j.total_rows)}
                  </td>

                  <td>
                    {formatNumber(j.clean_count)}
                  </td>

                  <td>
                    {formatNumber(j.matched_count)}
                  </td>

                  <td>
                    {formatNumber(j.invalid_count)}
                  </td>

                  <td>
                    {formatNumber(j.duplicate_count)}
                  </td>

                  <td>
                    <StatusBadge value={j.status} />
                  </td>

                  <td>
                    {duration(
                      j.started_at,
                      j.completed_at
                    )}
                  </td>

                  <td>
                    <div
                      className="row-actions"
                      style={{
                        display: 'flex',
                        gap: 6,
                        alignItems: 'center',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      <Link
                        className="icon-btn"
                        to={`/jobs/${j.id}`}
                        title="View"
                      >
                        <Eye size={14} />
                      </Link>

                      {canRestart && (
                        <button
                          type="button"
                          className="icon-btn"
                          title="Restart job"
                          disabled={
                            Boolean(working) &&
                            !restarting
                          }
                          onClick={() =>
                            restartJob(j)
                          }
                        >
                          <RotateCcw size={14} />

                          {restarting && (
                            <span
                              style={{
                                marginLeft: 5
                              }}
                            >
                              Restarting…
                            </span>
                          )}
                        </button>
                      )}

                      {running && (
                        <button
                          type="button"
                          className="icon-btn"
                          title="Cancel job"
                          disabled={
                            Boolean(working) &&
                            !cancelling
                          }
                          onClick={() =>
                            cancelJob(j)
                          }
                          style={{
                            color:
                              'var(--color-danger, #b84a4a)'
                          }}
                        >
                          <XCircle size={14} />

                          {cancelling && (
                            <span
                              style={{
                                marginLeft: 5
                              }}
                            >
                              Cancelling…
                            </span>
                          )}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
