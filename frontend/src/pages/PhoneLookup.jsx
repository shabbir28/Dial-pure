import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import api from '../services/api';
import Button from '../components/Button';
import StatusBadge from '../components/StatusBadge';
import TablePager from '../components/TablePager';
import { useToast } from '../components/Toast';
import { useAuth } from '../context/AuthContext';
import { formatDate, formatNumber } from '../utils/format';
import './Dashboard.css';

function LookupStats({ total = 0, unique = 0, alreadyPresent = 0 }) {
  return (
    <div className="dash-stats dash-stats--3" style={{ marginBottom: 16 }}>
      <article>
        <span>Total numbers</span>
        <strong>{formatNumber(total)}</strong>
      </article>
      <article>
        <span>Unique</span>
        <strong>{formatNumber(unique)}</strong>
      </article>
      <article>
        <span>Already present</span>
        <strong>{formatNumber(alreadyPresent)}</strong>
      </article>
    </div>
  );
}

export default function PhoneLookup() {
  const { user } = useAuth();
  const toast = useToast();
  const [params] = useSearchParams();
  const isAdmin = user?.role === 'admin';
  const [tab, setTab] = useState(params.get('q') ? 'search' : 'uploads');
  const [q, setQ] = useState(params.get('q') || '');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [agents, setAgents] = useState([]);
  const [agentId, setAgentId] = useState(params.get('agentId') || '');
  const [status, setStatus] = useState('');
  const [uploads, setUploads] = useState({ items: [], pagination: {}, stats: null });
  const [uploadPhone, setUploadPhone] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    if (isAdmin) {
      api.get('/users', { params: { role: 'agent', pageSize: 100 } }).then((r) => setAgents(r.data.items));
    }
  }, [isAdmin]);

  useEffect(() => {
    if (tab === 'uploads') {
      loadUploads(agentId, page, pageSize);
    }
  }, [tab, page, pageSize]);

  async function search(e) {
    e?.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await api.get('/lookup/phone', { params: { q: q.trim() } });
      setResult(res.data);
    } catch (error) {
      toast.push(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function loadUploads(nextAgent = agentId, nextPage = page, nextSize = pageSize) {
    setBusy(true);
    try {
      const res = await api.get('/lookup/uploads', {
        params: {
          agentId: isAdmin ? (nextAgent || undefined) : undefined,
          phone: uploadPhone || undefined,
          status: status || undefined,
          page: nextPage,
          pageSize: nextSize,
        },
      });
      setUploads(res.data);
    } catch (error) {
      toast.push(error.message);
    } finally {
      setBusy(false);
    }
  }

  function applyFilters() {
    setPage(1);
    loadUploads(agentId, 1, pageSize);
  }

  return (
    <div>
      <h2 className="page-title">Phone lookup</h2>
      <p className="page-sub">
        Browse every uploaded number, or search one number against campaign lists and prior jobs.
      </p>

      <div className="filters">
        <button type="button" className={`btn ${tab === 'uploads' ? 'btn--primary' : 'btn--secondary'}`} onClick={() => setTab('uploads')}>
          Uploaded numbers
        </button>
        <button type="button" className={`btn ${tab === 'search' ? 'btn--primary' : 'btn--secondary'}`} onClick={() => setTab('search')}>
          Search number
        </button>
      </div>

      {tab === 'search' && (
        <>
          <form className="card" onSubmit={search} style={{ marginBottom: 16 }}>
            <div className="filters" style={{ marginBottom: 0, alignItems: 'flex-end' }}>
              <label className="field" style={{ marginBottom: 0, flex: 1, minWidth: 240 }}>
                <label>Phone number</label>
                <input
                  className="input"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="2165988930 or (216) 598-8930"
                />
              </label>
              <Button type="submit" disabled={busy}>
                <Search size={16} /> {busy ? 'Searching…' : 'Search'}
              </Button>
            </div>
          </form>

          {result && (
            <>
              <LookupStats
                total={result.stats?.total ?? result.uploads.length}
                unique={result.stats?.unique ?? (result.uploads.length || result.campaigns.length ? 1 : 0)}
                alreadyPresent={result.stats?.alreadyPresent ?? result.campaigns.length}
              />

              <div className="card" style={{ marginBottom: 16 }}>
                <h3>Campaign master lists</h3>
                {result.campaigns.length === 0 ? (
                  <p style={{ color: 'var(--color-muted)' }}>This number is not on any campaign version.</p>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr><th>Campaign</th><th>Version</th><th>Version status</th><th>Source row</th><th>Activated</th></tr>
                    </thead>
                    <tbody>
                      {result.campaigns.map((c) => (
                        <tr key={`${c.version_id}-${c.source_row_number}`}>
                          <td><Link to={`/campaigns/${c.campaign_id}`}>{c.campaign_name}</Link> · {c.campaign_code}</td>
                          <td>v{c.version_number}</td>
                          <td><StatusBadge value={c.version_status} /></td>
                          <td>{c.source_row_number}</td>
                          <td>{formatDate(c.activated_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="card">
                <h3>Who uploaded this number</h3>
                {result.uploads.length === 0 ? (
                  <p style={{ color: 'var(--color-muted)' }}>No agent has uploaded this number yet.</p>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Agent</th>
                        <th>Job</th>
                        <th>Campaign</th>
                        <th>File</th>
                        <th>Phone</th>
                        <th>Uploaded</th>
                        <th>IP</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.uploads.map((row) => (
                        <tr key={`${row.jobId}-${row.sourceRow}`}>
                          <td>{row.sourceRow}</td>
                          <td>
                            {row.agent.name}
                            <div style={{ color: 'var(--color-muted)', fontSize: 12 }}>{row.agent.email}</div>
                          </td>
                          <td><Link to={`/jobs/${row.jobId}`}>{row.jobNumber}</Link></td>
                          <td>{row.campaignName} v{row.versionNumber}</td>
                          <td>{row.filename}</td>
                          <td>{row.phone.national}</td>
                          <td>{formatDate(row.uploadedAt)}</td>
                          <td>{row.uploadedIp || '—'}</td>
                          <td><StatusBadge value={row.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </>
      )}

      {tab === 'uploads' && (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="filters" style={{ marginBottom: 0 }}>
              {isAdmin && (
                <select className="input" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                  <option value="">All agents</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>{a.first_name} {a.last_name} · {a.email}</option>
                  ))}
                </select>
              )}
              <input
                className="input"
                placeholder="Phone or last 4"
                value={uploadPhone}
                onChange={(e) => setUploadPhone(e.target.value)}
              />
              <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All statuses</option>
                <option value="clean">clean</option>
                <option value="match">match</option>
                <option value="invalid">invalid</option>
                <option value="duplicate">duplicate</option>
              </select>
              <Button type="button" onClick={applyFilters}>Filter</Button>
            </div>
          </div>
          <LookupStats
            total={uploads.stats?.total ?? uploads.pagination?.total ?? 0}
            unique={uploads.stats?.unique ?? 0}
            alreadyPresent={uploads.stats?.alreadyPresent ?? 0}
          />
          <div className="card">
            <h3>Uploaded numbers</h3>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Agent</th>
                    <th>Phone</th>
                    <th>Job</th>
                    <th>Campaign</th>
                    <th>File</th>
                    <th>Uploaded</th>
                    <th>IP</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(uploads.items || []).length === 0 ? (
                    <tr><td colSpan={9} style={{ color: 'var(--color-muted)' }}>{busy ? 'Loading…' : 'No uploaded numbers yet.'}</td></tr>
                  ) : uploads.items.map((row) => (
                    <tr key={`${row.jobId}-${row.sourceRow}`}>
                      <td>{row.sourceRow}</td>
                      <td>
                        {row.agent.name}
                        <div style={{ color: 'var(--color-muted)', fontSize: 12 }}>{row.agent.email}</div>
                      </td>
                      <td>{row.phone.national}</td>
                      <td><Link to={`/jobs/${row.jobId}`}>{row.jobNumber}</Link></td>
                      <td>{row.campaignName} v{row.versionNumber}</td>
                      <td>{row.filename}</td>
                      <td>{formatDate(row.uploadedAt)}</td>
                      <td>{row.uploadedIp || '—'}</td>
                      <td><StatusBadge value={row.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <TablePager
              pagination={uploads.pagination}
              pageSize={pageSize}
              onPage={setPage}
              onPageSize={(size) => { setPageSize(size); setPage(1); }}
            />
          </div>
        </>
      )}
    </div>
  );
}
