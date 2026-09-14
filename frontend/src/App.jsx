import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import AppLayout from './layouts/AppLayout';
import Login from './pages/Login';
import AdminDashboard from './pages/AdminDashboard';
import AgentDashboard from './pages/AgentDashboard';
import Campaigns from './pages/Campaigns';
import CampaignDetail from './pages/CampaignDetail';
import InternalSales from './pages/InternalSales';
import InternalDncDead from './pages/InternalDncDead';
import Agents from './pages/Agents';
import BranchReports from './pages/BranchReports';
import Jobs from './pages/Jobs';
import JobDetail from './pages/JobDetail';
import NewScrub from './pages/NewScrub';
import Downloads from './pages/Downloads';
import Audit from './pages/Audit';
import Settings from './pages/Settings';
import Files from './pages/Files';
import PhoneLookup from './pages/PhoneLookup';
import Profile from './pages/Profile';

function Protected({ children, role }) {
  const { user, loading } = useAuth();
  if (loading) return <p style={{ padding: 40 }}>Loading...</p>;
  if (!user) return <Navigate to="/login" replace />;
  if (role && user.role !== role) {
    return <Navigate to={user.role === 'admin' ? '/admin' : '/agent'} replace />;
  }
  return <AppLayout>{children}</AppLayout>;
}

export default function App() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to={user.role === 'admin' ? '/admin' : '/agent'} /> : <Login />} />
      <Route path="/admin" element={<Protected role="admin"><AdminDashboard /></Protected>} />
      <Route path="/agent" element={<Protected><AgentDashboard /></Protected>} />
      <Route path="/campaigns" element={<Protected role="admin"><Campaigns /></Protected>} />
      <Route path="/campaigns/:id" element={<Protected role="admin"><CampaignDetail /></Protected>} />
      <Route path="/internal-sales" element={<Protected role="admin"><InternalSales /></Protected>} />
      <Route path="/internal-dnc" element={<Protected role="admin"><InternalDncDead /></Protected>} />
      <Route path="/agents" element={<Protected role="admin"><Agents /></Protected>} />
      <Route path="/branch-reports" element={<Protected role="admin"><BranchReports /></Protected>} />
      <Route path="/jobs" element={<Protected><Jobs /></Protected>} />
      <Route path="/jobs/:id" element={<Protected><JobDetail /></Protected>} />
      <Route path="/new-scrub" element={<Protected><NewScrub /></Protected>} />
      <Route path="/downloads" element={<Protected><Downloads /></Protected>} />
      <Route path="/audit" element={<Protected role="admin"><Audit /></Protected>} />
      <Route path="/settings" element={<Protected role="admin"><Settings /></Protected>} />
      <Route path="/files" element={<Protected role="admin"><Files /></Protected>} />
      <Route path="/lookup" element={<Protected><PhoneLookup /></Protected>} />
      <Route path="/profile" element={<Protected><Profile /></Protected>} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
