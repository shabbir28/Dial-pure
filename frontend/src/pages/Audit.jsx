import { useEffect, useState } from 'react';
import api from '../services/api';
import { formatDate } from '../utils/format';
import Button from '../components/Button';

export default function Audit() {
  const [items, setItems] = useState([]);
  const [action, setAction] = useState('');
  async function load() {
    const res = await api.get('/audit-logs', { params: { pageSize: 50, action } });
    setItems(res.data.items);
  }
  useEffect(() => { load(); }, []);
  return (
    <div>
      <h2 className="page-title">Audit trail</h2>
      <p className="page-sub">Append-only. Events are chained so later edits are detectable.</p>
      <div className="filters">
        <input className="input" placeholder="Action" value={action} onChange={(e) => setAction(e.target.value)} />
        <Button type="button" variant="secondary" onClick={load}>Filter</Button>
      </div>
      <div className="card table-wrap">
        <table className="data-table">
          <thead>
            <tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>IP</th><th>Request</th></tr>
          </thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.id}>
                <td>{formatDate(a.created_at)}</td>
                <td>{a.email || 'system'}</td>
                <td>{a.action}</td>
                <td>{a.entity_type} {a.entity_id?.slice(0, 8)}</td>
                <td>{a.ip_address}</td>
                <td>{a.request_id?.slice(0, 8)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
