import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Megaphone, Users, ListChecks, Files, ScrollText,
  Settings, PlusCircle, Download, UserRound, Moon, Sun, Search, LogOut, Database, BarChart3, ShieldAlert
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import BrandLogo from '../components/BrandLogo';

const adminNav = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/new-scrub', label: 'Upload', icon: PlusCircle },
  { to: '/campaigns', label: 'Campaigns', icon: Megaphone },
  { to: '/internal-sales', label: 'Internal Lists', icon: Database },
  { to: '/internal-dnc', label: 'DNC / Dead', icon: ShieldAlert },
  { to: '/agents', label: 'Agents', icon: Users },
  { to: '/branch-reports', label: 'Branch Reports', icon: BarChart3 },
  { to: '/jobs', label: 'Scrub Jobs', icon: ListChecks },
  { to: '/downloads', label: 'Downloads', icon: Download },
  { to: '/lookup', label: 'Phone Lookup', icon: Search },
  { to: '/files', label: 'Files', icon: Files },
  { to: '/audit', label: 'Audit Trail', icon: ScrollText },
  { to: '/settings', label: 'System Settings', icon: Settings },
];

const agentNav = [
  { to: '/agent', label: 'Dashboard', icon: LayoutDashboard },
];

export default function AppLayout({ children }) {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const items = user?.role === 'admin' ? adminNav : agentNav;
  const initials = `${user?.firstName?.[0] || 'U'}${user?.lastName?.[0] || ''}`;

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <BrandLogo />
          </div>
          <div>
            <h1>DialPure</h1>
            <p>Campaign list hygiene</p>
          </div>
        </div>
        <nav className="nav-group">
          <div className="nav-label">{user?.role}</div>
          {items.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <item.icon size={18} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-user">
          <div className="sidebar-user__meta">
            <div className="sidebar-avatar"><span className="mono">{initials}</span></div>
            <div>
              <strong>{user?.firstName} {user?.lastName}</strong>
              <small>{user?.email}</small>
            </div>
          </div>
          <button type="button" className="sidebar-logout" onClick={handleLogout}>
            <LogOut size={15} /> Log out
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div>
            {user?.role === 'admin' ? (
              <>
                <h1 className="page-title" style={{ margin: 0, fontSize: '1.45rem' }}>
                  Operations floor
                </h1>
                <p className="page-sub" style={{ margin: 0 }}>
                  Pin a campaign version, scrub the file, keep the trail.
                </p>
              </>
            ) : (
              <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600, color: 'var(--color-ink)' }}>
                Welcome back,
              </h2>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button type="button" className="btn btn--icon" onClick={toggle} title="Toggle theme">
              {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
            </button>
            <div className="topbar-user">
              <div className="topbar-avatar"><span className="mono">{initials}</span></div>
              <div className="topbar-user__text">
                <strong>{user?.firstName} {user?.lastName}</strong>
                <small>{user?.role}</small>
              </div>
            </div>
          </div>
        </header>
        <div className="page">{children}</div>
      </div>
    </div>
  );
}
