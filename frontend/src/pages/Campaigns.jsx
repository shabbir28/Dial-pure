import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import api from '../services/api';
import Modal from '../components/Modal';
import Button from '../components/Button';
import RowActions from '../components/RowActions';
import ConfirmDialog from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import { formatNumber } from '../utils/format';
import StatusBadge from '../components/StatusBadge';

function previewCampaignCode(items) {
  let max = 0;
  for (const item of items || []) {
    const match = String(item.campaign_code || '').match(/^CAMP-(\d+)$/i);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `CAMP-${max + 1}`;
}

const empty = { name: '', status: 'active' };

export default function Campaigns() {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [pendingArchive, setPendingArchive] = useState(null);

  async function load() {
    const res = await api.get('/campaigns', { params: { pageSize: 100 } });
    setItems(res.data.items);
  }
  useEffect(() => { load(); }, []);

  function startCreate() {
    setEditing(null);
    setForm(empty);
    setOpen(true);
  }

  function startEdit(row) {
    setEditing(row);
    setForm({
      name: row.name || '',
      status: row.status || 'active',
    });
    setOpen(true);
  }

  async function save(e) {
    e.preventDefault();
    try {
      if (editing) {
        await api.patch(`/campaigns/${editing.id}`, {
          name: form.name,
          status: form.status,
        });
        toast.push('Campaign updated');
      } else {
        await api.post('/campaigns', { name: form.name, status: form.status });
        toast.push('Campaign created');
      }
      setOpen(false);
      load();
    } catch (error) {
      toast.push(error.message);
    }
  }

  async function archive(row) {
    try {
      await api.patch(`/campaigns/${row.id}`, { status: 'archived' });
      toast.push('Campaign archived');
      setPendingArchive(null);
      load();
    } catch (error) {
      toast.push(error.message);
    }
  }

  const codeValue = editing ? editing.campaign_code : previewCampaignCode(items);
  const numbersValue = editing ? formatNumber(editing.active_unique_numbers || 0) : '0';

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 className="page-title">Campaigns</h2>
          <p className="page-sub">Create a campaign, then scrub lead files against numbers already in the database.</p>
        </div>
        <Button onClick={startCreate}><Plus size={16} /> Create campaign</Button>
      </div>
      <div className="card table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Code</th><th>Name</th><th>Status</th><th>Numbers</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.id}>
                <td><Link to={`/campaigns/${c.id}`}>{c.campaign_code}</Link></td>
                <td>{c.name}</td>
                <td><StatusBadge value={c.status} /></td>
                <td>{formatNumber(c.active_unique_numbers)}</td>
                <td>
                  <RowActions
                    onEdit={() => startEdit(c)}
                    onDelete={c.status === 'archived' ? null : () => setPendingArchive(c)}
                    deleteTitle="Archive"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open && (
        <Modal title={editing ? 'Edit campaign' : 'Create campaign'} onClose={() => setOpen(false)}>
          <form onSubmit={save}>
            <div className="field">
              <label>Code</label>
              <input className="input input--locked" value={codeValue} readOnly tabIndex={-1} />
            </div>
            <div className="field">
              <label>Name</label>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div className="field">
              <label>Status</label>
              <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="active">active</option>
                <option value="inactive">inactive</option>
                <option value="archived">archived</option>
              </select>
            </div>
            <div className="field">
              <label>Numbers</label>
              <input className="input input--locked" value={numbersValue} readOnly tabIndex={-1} />
              <p className="upload-hint">Populated as agents publish numbers against this campaign.</p>
            </div>
            <div className="modal-actions">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit">Save</Button>
            </div>
          </form>
        </Modal>
      )}
      {pendingArchive && (
        <ConfirmDialog
          title="Archive campaign"
          body={`${pendingArchive.name} will be archived. Historical jobs stay linked to this campaign.`}
          confirmLabel="Archive"
          danger
          onClose={() => setPendingArchive(null)}
          onConfirm={() => archive(pendingArchive)}
        />
      )}
    </div>
  );
}
