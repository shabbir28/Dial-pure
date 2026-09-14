import { useEffect, useState } from 'react';
import api from '../services/api';
import { useToast } from '../components/Toast';
import Button from '../components/Button';

export default function Settings() {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  useEffect(() => {
    api.get('/settings').then((r) => setRows(r.data.raw || []));
  }, []);
  async function save(row) {
    let value = row.setting_value;
    try {
      if (typeof value === 'string') value = JSON.parse(value);
    } catch {}
    await api.patch(`/settings/${row.setting_key}`, { value, description: row.description });
    toast.push('Saved');
  }
  return (
    <div>
      <h2 className="page-title">System settings</h2>
      <p className="page-sub">Allowed file types and phone country. Uploads can be up to 500 MB. Job and file history is kept permanently.</p>
      {rows.map((row) => (
        <div className="card" key={row.id} style={{ marginBottom: 12 }}>
          <strong>{row.setting_key}</strong>
          <p style={{ color: 'var(--fg-mute)' }}>{row.description}</p>
          <textarea
            className="input"
            rows={3}
            value={typeof row.setting_value === 'string' ? row.setting_value : JSON.stringify(row.setting_value, null, 2)}
            onChange={(e) => setRows(rows.map((r) => r.id === row.id ? { ...r, setting_value: e.target.value } : r))}
          />
          <Button style={{ marginTop: 10 }} onClick={() => save(row)}>Save</Button>
        </div>
      ))}
    </div>
  );
}
