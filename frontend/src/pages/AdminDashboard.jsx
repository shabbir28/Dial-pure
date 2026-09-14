import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts';
import {
  Plus, Ban, DollarSign, Shield, Hash, CheckCircle2, AlertTriangle,
  UploadCloud, Megaphone, Users, XCircle, TrendingUp, TrendingDown, Minus,
  Database, Activity, Sparkles, ShieldAlert, Layers, RefreshCw
} from 'lucide-react';
import api from '../services/api';
import { connectSocket } from '../services/socket';
import { formatNumber } from '../utils/format';
import StatusBadge from '../components/StatusBadge';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import './Dashboard.css';

const CHART = {
  forest: '#1f6f5b',
  copper: '#c45c26',
  stone: '#57534e',
  ink: '#292524',
  sand: '#d6a15c',
};
const MIX_COLORS = {
  Clean: '#1f6f5b',
  Match: '#c45c26',
  Invalid: '#b42318',
  Duplicate: '#b45309',
};
const STATUS_COLORS = {
  completed: '#1f6f5b',
  processing: '#c45c26',
  queued: '#d6a15c',
  validating: '#b45309',
  generating_exports: '#57534e',
  failed: '#b42318',
  cancelled: '#a8a29a',
};

// KPI icon map
const KPI_ICONS = {
  ban: Ban,
  dollar: DollarSign,
  shield: Shield,
  hash: Hash,
  check: CheckCircle2,
  alert: AlertTriangle,
  upload: UploadCloud,
  megaphone: Megaphone,
  users: Users,
  x: XCircle,
  database: Database,
  activity: Activity,
  sparkles: Sparkles,
  layers: Layers,
  shieldAlert: ShieldAlert,
};

// KPI color palette
const KPI_COLORS = {
  danger:  { bg: '#b4231815', border: '#b4231830', icon: '#b42318', text: '#b42318' },
  purple:  { bg: '#7c3aed15', border: '#7c3aed30', icon: '#7c3aed', text: '#7c3aed' },
  stone:   { bg: '#57534e15', border: '#57534e30', icon: '#57534e', text: '#57534e' },
  copper:  { bg: '#c45c2615', border: '#c45c2630', icon: '#c45c26', text: '#c45c26' },
  success: { bg: '#1f6f5b15', border: '#1f6f5b30', icon: '#1f6f5b', text: '#1f6f5b' },
  warn:    { bg: '#b4530915', border: '#b4530930', icon: '#b45309', text: '#b45309' },
  forest:  { bg: '#1f6f5b15', border: '#1f6f5b30', icon: '#1f6f5b', text: '#1f6f5b' },
  sky:     { bg: '#0284c715', border: '#0284c730', icon: '#0284c7', text: '#0284c7' },
  indigo:  { bg: '#4f46e515', border: '#4f46e530', icon: '#4f46e5', text: '#4f46e5' },
};

function Panel({ title, action, children, className = '' }) {
  return (
    <section className={`dash-panel ${className}`}>
      <header className="dash-panel__head">
        <h3>{title}</h3>
        {action}
      </header>
      <div className="dash-panel__body">{children}</div>
    </section>
  );
}

function KpiCard({ kpi, isLifetime = false }) {
  const Icon = KPI_ICONS[kpi.icon] || Hash;
  const palette = KPI_COLORS[kpi.color] || KPI_COLORS.stone;
  const up = kpi.delta > 0;
  const down = kpi.delta < 0;
  const hasBreakdown = kpi.breakdown && (kpi.breakdown.sales !== undefined || kpi.breakdown.suppression !== undefined);

  return (
    <article
      style={{
        background: 'var(--color-surface)',
        border: isLifetime ? `1px solid ${palette.border}` : '1px solid var(--color-border)',
        borderRadius: 12,
        padding: '13px 14px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        position: 'relative',
        boxShadow: isLifetime ? `0 2px 12px ${palette.bg}` : 'var(--shadow-sm)',
        transition: 'transform .15s ease, box-shadow .15s ease, border-color .15s ease',
        minHeight: hasBreakdown ? 172 : 136,
        minWidth: 0,
        overflow: 'hidden',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,.08)';
        e.currentTarget.style.borderColor = palette.icon;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = '';
        e.currentTarget.style.boxShadow = isLifetime ? `0 2px 12px ${palette.bg}` : 'var(--shadow-sm)';
        e.currentTarget.style.borderColor = isLifetime ? palette.border : 'var(--color-border)';
      }}
    >
      {/* Accent top bar */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          background: palette.icon,
          borderRadius: '12px 12px 0 0',
        }}
      />

      {/* Header Row: Icon & Status / Badges */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            background: palette.bg,
            border: `1px solid ${palette.border}`,
            display: 'grid',
            placeItems: 'center',
            flexShrink: 0,
          }}
        >
          <Icon size={17} color={palette.icon} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {kpi.badge && (
            <span
              style={{
                fontSize: '0.68rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: palette.icon,
                background: palette.bg,
                padding: '2px 7px',
                borderRadius: 4,
                border: `1px solid ${palette.border}`,
                whiteSpace: 'nowrap',
              }}
            >
              {kpi.badge}
            </span>
          )}

          {kpi.delta !== 0 && !kpi.badge && (
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 3,
                fontSize: '0.74rem',
                fontWeight: 600,
                color: up ? '#1f6f5b' : down ? '#b42318' : '#57534e',
                background: up ? '#1f6f5b15' : down ? '#b4231815' : '#57534e15',
                borderRadius: 12,
                padding: '2px 7px',
                whiteSpace: 'nowrap',
              }}
            >
              {up ? <TrendingUp size={11} /> : down ? <TrendingDown size={11} /> : <Minus size={11} />}
              {Math.abs(kpi.delta).toFixed(1)}%
            </span>
          )}

          {isLifetime && (
            <span
              style={{
                fontSize: '0.65rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: palette.icon,
                background: palette.bg,
                padding: '2px 6px',
                borderRadius: 4,
                border: `1px solid ${palette.border}`,
                whiteSpace: 'nowrap',
              }}
            >
              All-Time
            </span>
          )}
        </div>
      </div>

      {/* Label */}
      <div
        style={{
          fontSize: '0.76rem',
          fontWeight: 600,
          color: 'var(--color-muted)',
          marginBottom: 6,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={kpi.label}
      >
        {kpi.label}
      </div>

      {/* Body: Dual Metric Breakdown OR Single Value */}
      {hasBreakdown ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <div
            style={{
              background: 'var(--bg-higher)',
              border: '1px solid var(--color-border)',
              borderRadius: 8,
              padding: '8px 10px',
              display: 'flex',
              flexDirection: 'column',
              gap: 5,
            }}
          >
            {/* Sales Row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.74rem', fontWeight: 600, color: '#9061f9' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#7e3af2', display: 'inline-block', flexShrink: 0 }} />
                <span>Sales</span>
              </div>
              <strong style={{ fontSize: '0.96rem', fontWeight: 700, color: 'var(--color-ink)', letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>
                {formatNumber(kpi.breakdown.sales || 0)}
              </strong>
            </div>

            {/* Divider */}
            <div style={{ height: 1, background: 'var(--color-border)', opacity: 0.6 }} />

            {/* Suppression Row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.74rem', fontWeight: 600, color: '#f59e0b' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#d97706', display: 'inline-block', flexShrink: 0 }} />
                <span>Suppression</span>
              </div>
              <strong style={{ fontSize: '0.96rem', fontWeight: 700, color: 'var(--color-ink)', letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>
                {formatNumber(kpi.breakdown.suppression || 0)}
              </strong>
            </div>
          </div>

          {/* Active Total Footer */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '0.72rem',
              color: 'var(--color-muted)',
              padding: '0 2px',
            }}
          >
            <span>Total Active:</span>
            <strong style={{ color: 'var(--color-ink)', fontWeight: 700, fontSize: '0.8rem' }}>
              {formatNumber(kpi.value)}
            </strong>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <strong
            style={{
              fontSize: isLifetime ? '1.75rem' : '1.55rem',
              fontWeight: 800,
              lineHeight: 1.1,
              color: 'var(--color-ink)',
              letterSpacing: '-0.025em',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {formatNumber(kpi.value)}
          </strong>
          {kpi.sub && (
            <div
              style={{
                fontSize: '0.74rem',
                color: 'var(--color-muted)',
                lineHeight: 1.3,
                marginTop: 2,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={kpi.sub}
            >
              {kpi.sub}
            </div>
          )}
        </div>
      )}
    </article>
  );
}


export default function AdminDashboard() {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [data, setData] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const grid = theme === 'dark' ? '#3a322b' : '#ebe4d6';
  const tick = theme === 'dark' ? '#a8a29a' : '#6b6258';

  const load = async (showLoading = false) => {
    try {
      if (showLoading) setRefreshing(true);
      const res = await api.get('/admin/dashboard');
      setData(res.data);
    } catch (err) {
      console.error('Failed to load dashboard:', err);
    } finally {
      if (showLoading) setRefreshing(false);
    }
  };

  useEffect(() => {
    load();

    // 10 second auto-refresh
    const interval = setInterval(() => load(false), 10000);

    // Real-time socket updates whenever any job runs, updates, or finishes
    const socket = connectSocket();
    const handleUpdate = () => {
      load(false);
    };
    socket.on('dashboard:update', handleUpdate);

    return () => {
      clearInterval(interval);
      socket.off('dashboard:update', handleUpdate);
    };
  }, []);

  const mix = useMemo(() => {
    if (!data) return [];
    const s = data.stats;
    return [
      { name: 'Clean', value: s.cleanToday },
      { name: 'Match', value: s.matchedToday },
      { name: 'Invalid', value: s.invalidToday },
      { name: 'Duplicate', value: s.duplicateToday },
    ];
  }, [data]);
  const mixTotal = mix.reduce((sum, x) => sum + x.value, 0);

  const internalListKpis = useMemo(() => {
    if (!data) return [];
    const list = [...(data.internalListKpis || [])];
    const hasAca = list.some((k) => k.key === 'aca_lists');
    const hasMed = list.some((k) => k.key === 'medicare_lists');
    if (!hasAca && data.stats) {
      const acaSales = data.stats.acaSalesNumbers ?? (data.stats.salesTotalNumbers || 0);
      const acaSupp = data.stats.acaSuppNumbers ?? (data.stats.suppTotalNumbers || 0);
      list.push({
        key: 'aca_lists',
        label: 'ACA Campaign',
        badge: 'CAMP-1',
        icon: 'layers',
        color: 'forest',
        value: acaSales + acaSupp,
        delta: 0,
        sub: `Total: ${(acaSales + acaSupp).toLocaleString()} leads`,
        breakdown: { sales: acaSales, suppression: acaSupp },
      });
    }
    if (!hasMed && data.stats) {
      const medSales = data.stats.medicareSalesNumbers ?? 0;
      const medSupp = data.stats.medicareSuppNumbers ?? 0;
      list.push({
        key: 'medicare_lists',
        label: 'Medicare Campaign',
        badge: 'CAMP-3',
        icon: 'sky',
        color: 'sky',
        value: medSales + medSupp,
        delta: 0,
        sub: `Total: ${(medSales + medSupp).toLocaleString()} leads`,
        breakdown: { sales: medSales, suppression: medSupp },
      });
    }
    return list;
  }, [data]);

  if (!data) return <p className="page-sub">Loading operations…</p>;
  const s = data.stats;

  return (
    <div className="dash">
      {/* Hero */}
      <div className="dash-hero">
        <div>
          <h2>Operations floor · {user?.firstName}</h2>
          <p>
            Updated {new Date(data.refreshedAt).toLocaleTimeString()} · Live auto-refresh active
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            className="btn btn--outline"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'transparent', color: '#f5efe6', border: '1px solid rgba(245,239,230,0.25)',
              padding: '8px 14px', borderRadius: 6, fontSize: '0.84rem', cursor: 'pointer'
            }}
            onClick={() => load(true)}
            disabled={refreshing}
          >
            <RefreshCw size={14} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
            {refreshing ? 'Updating…' : 'Refresh Live'}
          </button>
          <Link to="/new-scrub" className="btn btn--primary"><Plus size={16} /> New scrub</Link>
        </div>
      </div>

      {/* Quick links */}
      <div className="dash-actions">
        <Link className="dash-chip" to="/campaigns">Campaigns</Link>
        <Link className="dash-chip" to="/internal-sales">Internal Lists</Link>
        <Link className="dash-chip" to="/internal-dnc">DNC / Dead</Link>
        <Link className="dash-chip" to="/agents">Agents</Link>
        <Link className="dash-chip" to="/jobs">All jobs</Link>
        <Link className="dash-chip" to="/lookup">Phone lookup</Link>
        <Link className="dash-chip" to="/audit">Audit trail</Link>
      </div>

      {/* 1. Lifetime Performance Header & Cards */}
      <div style={{ marginTop: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Database size={16} style={{ color: '#c45c26' }} />
            <h3 style={{ margin: 0, fontSize: '0.96rem', fontWeight: 700, letterSpacing: '-0.01em' }}>
              Lifetime Platform Totals
            </h3>
            <span style={{
              fontSize: '0.7rem', fontWeight: 600, background: 'var(--color-surface)',
              border: '1px solid var(--color-border)', borderRadius: 12, padding: '2px 9px', opacity: 0.75
            }}>
              Cumulative All-Time
            </span>
          </div>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
          gap: 14,
          marginBottom: 24,
        }}>
          {(data.lifetimeKpis && data.lifetimeKpis.length > 0) ? (
            data.lifetimeKpis.map((kpi) => (
              <KpiCard key={kpi.key} kpi={kpi} isLifetime={true} />
            ))
          ) : (
            <>
              <KpiCard kpi={{ key: 'lt_num', label: 'Lifetime Processed', icon: 'database', color: 'copper', value: s.lifetimeNumbers, sub: `Across ${s.lifetimeJobs} scrub jobs` }} isLifetime={true} />
              <KpiCard kpi={{ key: 'lt_clean', label: 'Lifetime Clean Leads', icon: 'check', color: 'success', value: s.lifetimeClean, sub: `${s.lifetimeNumbers > 0 ? ((s.lifetimeClean / s.lifetimeNumbers) * 100).toFixed(1) : 0}% clean rate` }} isLifetime={true} />
              <KpiCard kpi={{ key: 'lt_match', label: 'Lifetime Suppressed', icon: 'alert', color: 'danger', value: s.lifetimeMatched, sub: `${s.lifetimeNumbers > 0 ? ((s.lifetimeMatched / s.lifetimeNumbers) * 100).toFixed(1) : 0}% suppression rate` }} isLifetime={true} />
              <KpiCard kpi={{ key: 'lt_jobs', label: 'Lifetime Scrub Jobs', icon: 'activity', color: 'purple', value: s.lifetimeJobs, sub: s.failedJobs > 0 ? `${s.failedJobs} failed` : 'All successful' }} isLifetime={true} />
            </>
          )}
        </div>
      </div>

      {/* 2. Protection & Internal Lists */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Shield size={16} style={{ color: '#b42318' }} />
            <h3 style={{ margin: 0, fontSize: '0.96rem', fontWeight: 700, letterSpacing: '-0.01em' }}>
              Protection & Internal Lists
            </h3>
            <span style={{
              fontSize: '0.7rem', fontWeight: 600, background: 'var(--color-surface)',
              border: '1px solid var(--color-border)', borderRadius: 12, padding: '2px 9px', opacity: 0.75
            }}>
              Universal & Campaigns
            </span>
          </div>
        </div>

        <div
          className="dash-protection-grid"
          style={{
            marginBottom: 24,
          }}
        >
          {(internalListKpis || []).map((kpi) => (
            <KpiCard key={kpi.key} kpi={kpi} />
          ))}
        </div>
      </div>

      {/* 3. Today's Live Activity */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Activity size={16} style={{ color: '#1f6f5b' }} />
            <h3 style={{ margin: 0, fontSize: '0.96rem', fontWeight: 700, letterSpacing: '-0.01em' }}>
              Today's Live Scrubbing
            </h3>
            <span style={{
              fontSize: '0.7rem', fontWeight: 600, background: '#1f6f5b18', color: '#1f6f5b',
              border: '1px solid #1f6f5b35', borderRadius: 12, padding: '2px 9px'
            }}>
              Live 24h
            </span>
          </div>
        </div>

        <div
          className="dash-today-grid"
          style={{
            marginBottom: 24,
          }}
        >
          {(data.todayKpis || []).map((kpi) => (
            <KpiCard key={kpi.key} kpi={kpi} />
          ))}
        </div>
      </div>

      {/* Charts row */}
      <div className="dash-grid">
        <Panel title="Today classification mix">
          <div className="dash-chart--sm">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={mix} dataKey="value" nameKey="name" innerRadius={52} outerRadius={72} paddingAngle={2}>
                  {mix.map((entry) => <Cell key={entry.name} fill={MIX_COLORS[entry.name]} />)}
                </Pie>
                <Tooltip />
                <Legend verticalAlign="bottom" height={28} iconType="circle" />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <p className="page-sub" style={{ margin: '0 0 4px', textAlign: 'center' }}>{formatNumber(mixTotal)} numbers today</p>
        </Panel>

        <Panel title="Job status mix">
          <div className="dash-chart--sm">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.statusBreakdown} barSize={28}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={grid} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: tick, fontSize: 11 }} />
                <YAxis tickLine={false} axisLine={false} width={32} tick={{ fill: tick, fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {(data.statusBreakdown || []).map((entry) => (
                    <Cell key={entry.name} fill={STATUS_COLORS[entry.name] || CHART.stone} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      {/* Trend chart */}
      <Panel title="Throughput · last 14 days">
        <div className="dash-chart--md">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.trend}>
              <defs>
                <linearGradient id="gTotal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHART.copper} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={CHART.copper} stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="gClean" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHART.forest} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={CHART.forest} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={grid} />
              <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fill: tick, fontSize: 11 }} />
              <YAxis tickLine={false} axisLine={false} width={40} tick={{ fill: tick, fontSize: 11 }} />
              <Tooltip />
              <Legend iconType="circle" />
              <Area type="monotone" dataKey="total" name="Processed" stroke={CHART.copper} fill="url(#gTotal)" strokeWidth={2} />
              <Area type="monotone" dataKey="clean" name="Clean" stroke={CHART.forest} fill="url(#gClean)" strokeWidth={2} />
              <Area type="monotone" dataKey="matched" name="Matched" stroke={CHART.ink} fill="transparent" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      {/* Tables row */}
      <div className="dash-grid">
        <Panel title="Agent volume">
          <table className="dash-table">
            <thead>
              <tr><th>Agent</th><th>Jobs</th><th>Numbers</th><th>Clean</th></tr>
            </thead>
            <tbody>
              {(data.byAgent || []).length === 0 ? (
                <tr><td colSpan={4} className="dash-empty">No agent activity yet.</td></tr>
              ) : data.byAgent.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td>{formatNumber(row.jobs)}</td>
                  <td>{formatNumber(row.total)}</td>
                  <td>{formatNumber(row.clean)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel title="Recent scrub jobs" action={<Link className="dash-link" to="/jobs">View all</Link>}>
          <table className="dash-table">
            <thead>
              <tr><th>Job</th><th>Uploaded by</th><th>Campaign</th><th>Total</th><th>Status</th></tr>
            </thead>
            <tbody>
              {(data.recentJobs || []).length === 0 ? (
                <tr><td colSpan={5} className="dash-empty">No jobs yet.</td></tr>
              ) : data.recentJobs.slice(0, 8).map((j) => (
                <tr key={j.id}>
                  <td><Link className="dash-link" to={`/jobs/${j.id}`}>{j.job_number}</Link></td>
                  <td>{j.first_name} {j.last_name}</td>
                  <td>{j.campaign_name} v{j.version_number}</td>
                  <td>{formatNumber(j.total_rows)}</td>
                  <td><StatusBadge value={j.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </div>
  );
}
