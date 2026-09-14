import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../services/api';
import FileDrop from '../components/FileDrop';
import FilePreview from '../components/FilePreview';
import Button from '../components/Button';
import { useToast } from '../components/Toast';
import { formatDate, formatNumber } from '../utils/format';
import { MAX_UPLOAD_BYTES, isCsvFile, previewCsvFile } from '../utils/upload';
import StatusBadge from '../components/StatusBadge';

export default function CampaignDetail() {
  const { id } = useParams();
  const toast = useToast();
  const [campaign, setCampaign] = useState(null);
  const [agents, setAgents] = useState([]);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [phoneColumn, setPhoneColumn] = useState('Phone No');
  const [agentId, setAgentId] = useState('');

  async function load() {
    const res = await api.get(`/campaigns/${id}`);
    setCampaign(res.data);
  }
  useEffect(() => {
    load();
    api.get('/users', { params: { role: 'agent', pageSize: 100 } }).then((r) => setAgents(r.data.items));
  }, [id]);

  async function onFile(next) {
    if (next.size > MAX_UPLOAD_BYTES) {
      toast.push('File is larger than 500 MB.');
      return;
    }
    setFile(next);
    try {
      if (isCsvFile(next)) {
        const data = await previewCsvFile(next);
        setPreview(data);
        setPhoneColumn(data.suggestedPhoneColumn || 'Phone No');
        return;
      }
      if (next.size > 32 * 1024 * 1024) {
        setPreview({ headers: ['Phone No'], sampleRows: [], suggestedPhoneColumn: 'Phone No' });
        setPhoneColumn('Phone No');
        return;
      }
      const fd = new FormData();
      fd.append('file', next);
      const res = await api.post('/files/preview', fd);
      setPreview(res.data);
      setPhoneColumn(res.data.suggestedPhoneColumn || 'Phone No');
    } catch (error) {
      toast.push(error.message);
    }
  }

  async function uploadMaster() {
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.push('File is larger than 500 MB.');
      return;
    }
    const fd = new FormData();
    fd.append('file', file);
    fd.append('phoneColumn', phoneColumn);
    try {
      await api.post(`/campaigns/${id}/master-file`, fd);
      toast.push('Master file queued. It will become the active version when processing finishes.');
      setFile(null);
      setPreview(null);
      setTimeout(load, 1200);
    } catch (error) {
      toast.push(error.message);
    }
  }

  async function activate(versionId) {
    await api.post(`/campaigns/${id}/versions/${versionId}/activate`);
    toast.push('Version activated');
    load();
  }

  async function assign() {
    if (!agentId) return;
    await api.post(`/campaigns/${id}/agents`, { agentId });
    toast.push('Agent assigned');
    load();
  }

  if (!campaign) return <p>Loading...</p>;

  return (
    <div>
      <h2 className="page-title">{campaign.name}</h2>
      <p className="page-sub">{campaign.campaign_code} · {campaign.status} · US phone normalization</p>
      <div className="grid-2">
        <div className="card upload-panel">
          <h3>Upload new master version</h3>
          <FileDrop file={file} onFile={onFile} />
          {preview && (
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Phone number column</label>
              <input
                className="input"
                list="master-phone-columns"
                value={phoneColumn}
                onChange={(e) => setPhoneColumn(e.target.value)}
                placeholder="Phone No"
              />
              <datalist id="master-phone-columns">
                {preview.headers.map((h) => <option key={h} value={h} />)}
              </datalist>
            </div>
          )}
          {preview?.sampleRows?.length > 0 && (
            <FilePreview headers={preview.headers} rows={preview.sampleRows} phoneColumn={phoneColumn} />
          )}
          <Button onClick={uploadMaster} disabled={!file}>Upload version</Button>
        </div>
        <div className="card">
          <h3>Assign agent</h3>
          <select className="input" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            <option value="">Select agent</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.first_name} {a.last_name} · {a.email}</option>)}
          </select>
          <Button style={{ marginTop: 12 }} onClick={assign}>Assign</Button>
          <div style={{ marginTop: 16 }}>
            {(campaign.agents || []).map((a) => (
              <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--color-border)' }}>
                <span>{a.first_name} {a.last_name}</span>
                <StatusBadge value={a.is_active ? 'active' : 'inactive'} />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <h3>Versions</h3>
        <table className="data-table">
          <thead>
            <tr><th>Version</th><th>Status</th><th>File</th><th>Rows</th><th>Unique</th><th>Invalid</th><th>Dup</th><th>Activated</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {(campaign.versions || []).map((v) => (
              <tr key={v.id}>
                <td>v{v.version_number}</td>
                <td><StatusBadge value={v.status} /></td>
                <td>{v.original_filename}</td>
                <td>{formatNumber(v.total_rows)}</td>
                <td>{formatNumber(v.unique_numbers)}</td>
                <td>{formatNumber(v.invalid_numbers)}</td>
                <td>{formatNumber(v.duplicate_numbers)}</td>
                <td>{formatDate(v.activated_at)}</td>
                <td>
                  {v.status === 'ready' && (
                    <Button type="button" variant="secondary" size="sm" onClick={() => activate(v.id)}>Activate</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
