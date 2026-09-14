import { Activity, AlertCircle, Check, Download } from 'lucide-react';
import { formatNumber } from '../utils/format';

export default function JobStatusCard({ job, onDownload, isAdmin = false }) {
  const filename = job.original_filename || 'file';
  const pct = Number(job.processing_percentage || 0);
  const processing = !['completed', 'failed', 'cancelled'].includes(job.status);

  const combinedClientMatch =
    Number(job.sales_match_count || 0) +
    Number(job.dnc_dead_match_count || 0) +
    Number(job.suppression_match_count || 0) +
    Number(job.external_match_count || 0);

  if (job.status === 'failed' || job.status === 'cancelled') {
    return (
      <section className="job-card job-card--failed">
        <div className="job-card__head">
          <div className="job-card__icon"><AlertCircle size={18} /></div>
          <div>
            <h3>{job.status === 'failed' ? 'Job failed' : 'Job cancelled'} — {filename}</h3>
            <p>{job.failure_reason || 'This job did not finish successfully.'}</p>
          </div>
        </div>
      </section>
    );
  }

  if (processing) {
    const statusText =
      pct <= 8
        ? 'Loading suppression lists & preparing matching engine…'
        : pct < 80
        ? 'Scrubbing phone numbers against active campaign & global lists…'
        : 'Generating clean & matched export files…';

    const totalDisplay = job.total_rows > 0 ? formatNumber(job.total_rows) : '...';

    return (
      <section className="job-card job-card--processing">
        <div className="job-card__head">
          <div className="job-card__icon"><Activity size={18} /></div>
          <div>
            <h3>Processing <span className="job-card__filename">{filename}</span></h3>
            <p>{statusText}</p>
          </div>
        </div>
        <div className="progress-label">
          <span>Progress</span>
          <span>{pct.toFixed(0)}% · {formatNumber(job.processed_rows)} / {totalDisplay}</span>
        </div>
        <div className="progress"><span style={{ width: `${Math.max(pct, 4)}%` }} /></div>
      </section>
    );
  }

  if (job.status !== 'completed') return null;

  const exportsByType = Object.fromEntries((job.exports || []).map((e) => [e.export_type, e]));

  return (
    <section className="job-card job-card--done">
      <div className="job-card__head">
        <div className="job-card__icon"><Check size={18} /></div>
        <div>
          <h3>Job completed — {filename}</h3>
          <p>Your scrubbing job has finished processing</p>
        </div>
      </div>
      <div className="job-stats">
        <div>
          <span>Total rows</span>
          <strong>{formatNumber(job.total_rows)}</strong>
        </div>

        {isAdmin && (
          <>
            <div>
              <span>Sales Match</span>
              <strong className="is-match">
                {formatNumber(job.sales_match_count || 0)}
              </strong>
            </div>

            <div>
              <span>DNC / Dead Match</span>
              <strong className="is-match">
                {formatNumber(job.dnc_dead_match_count || 0)}
              </strong>
            </div>

            <div>
              <span>Suppression Match</span>
              <strong className="is-match">
                {formatNumber(job.suppression_match_count || 0)}
              </strong>
            </div>
          </>
        )}

        <div>
          <span>Client Match</span>
          <strong className="is-match">
            {formatNumber(
              isAdmin
                ? (job.external_match_count || 0)
                : combinedClientMatch
            )}
          </strong>
        </div>

        <div>
          <span>Clean</span>
          <strong className="is-clean">
            {formatNumber(job.clean_count || 0)}
          </strong>
        </div>

        <div>
          <span>{isAdmin ? 'Invalid' : 'Invalid Numbers'}</span>
          <strong className="is-invalid">
            {formatNumber(job.invalid_count || 0)}
          </strong>
        </div>

        <div>
          <span>{isAdmin ? 'Duplicates' : 'Duplicates Numbers'}</span>
          <strong className="is-dup">
            {formatNumber(job.duplicate_count || 0)}
          </strong>
        </div>
      </div>
      <div className="job-actions">
        {exportsByType.clean && (
          <button type="button" className="btn btn--success" onClick={() => onDownload(exportsByType.clean.id)}>
            <Download size={16} /> Download Clean
          </button>
        )}

        {isAdmin && exportsByType.external_matched && (
          <button
            type="button"
            className="btn"
            onClick={() => onDownload(exportsByType.external_matched.id)}
          >
            <Download size={16} /> Download Client Match
          </button>
        )}
      </div>
    </section>
  );
}
