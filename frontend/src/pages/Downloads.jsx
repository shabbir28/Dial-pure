import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { formatDate, formatNumber } from '../utils/format';

export default function Downloads() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    api.get('/scrub-jobs', { params: { pageSize: 50, status: 'completed' } }).then((r) => setItems(r.data.items));
  }, []);
  return (
    <div>
      <h2 className="page-title">Downloads</h2>
      <p className="page-sub">Completed jobs with generated result files.</p>
      <div className="card">
        <table className="data-table">
          <thead>
            <tr><th>Job</th><th>Campaign</th><th>File</th><th>Clean</th><th>Match</th><th>Completed</th></tr>
          </thead>
          <tbody>
            {items.map((j) => (
              <tr key={j.id}>
                <td><Link to={`/jobs/${j.id}`}>{j.job_number}</Link></td>
                <td>{j.campaign_name}</td>
                <td>{j.original_filename}</td>
                <td>{formatNumber(j.clean_count)}</td>
                <td>{formatNumber(j.matched_count)}</td>
                <td>{formatDate(j.completed_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
