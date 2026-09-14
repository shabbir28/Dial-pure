import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Moon, Sun } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../components/Toast';
import Button from '../components/Button';
import BrandLogo from '../components/BrandLogo';
import './Login.css';

export default function Login() {
  const { login } = useAuth();
  const { theme, toggle } = useTheme();
  const toast = useToast();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const user = await login(username, password);
      toast.push('Signed in');
      navigate(user.role === 'admin' ? '/admin' : '/agent');
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <button type="button" className="btn btn--icon login__theme" onClick={toggle} title="Toggle theme">
        {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
      </button>
      <div className="login__card">
        <div className="login__brand">
          <div className="login__mark">
            <BrandLogo />
          </div>
          <h1>DialPure</h1>
          <p>Match lead files against numbers already in your campaigns.</p>
        </div>
        <ol className="login__steps">
          <li>Match</li>
          <li>Clean</li>
          <li>Invalid</li>
          <li>Duplicate</li>
        </ol>
        <form className="login__form" onSubmit={submit}>
          <label className="field">
            <span className="field__label" style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-muted)' }}>Username</span>
            <input
              className="input"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              required
              autoComplete="username"
            />
          </label>
          <label className="field">
            <span className="field__label" style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-muted)' }}>Password</span>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </label>
          {error ? <div className="login__error">{error}</div> : null}
          <Button type="submit" disabled={busy} block>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </div>
    </div>
  );
}
