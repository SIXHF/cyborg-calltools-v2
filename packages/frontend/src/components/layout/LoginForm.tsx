import { useState, type FormEvent } from 'react';
import { useAuth } from '../../hooks/useAuth';

export function LoginForm() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login } = useAuth();

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username.trim() || !password.trim()) {
      setError('Please enter both username and password.');
      return;
    }

    login(username.trim(), password);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      {/* Header bar (visible even when logged out) */}
      <div className="header-gradient w-full fixed top-0 left-0 right-0 px-6 py-3.5 z-50">
        <h1 className="text-xl font-semibold text-ct-accent tracking-wide">
          Call Tools <span className="beta-badge">BETA</span>{' '}
          <span className="text-ct-muted font-normal text-base">/ Cyborg Telecom</span>
        </h1>
      </div>

      <form
        onSubmit={handleSubmit}
        className="w-full max-w-[380px] p-10"
        style={{
          background: 'rgba(22, 27, 34, 0.85)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          border: '1px solid rgba(33, 38, 45, 0.6)',
          borderRadius: 16,
          boxShadow: '0 8px 32px rgba(0,0,0,0.3), 0 0 1px rgba(255,255,255,0.05)',
        }}
      >
        <div className="text-center mb-6">
          <h2 className="text-lg font-semibold text-ct-text-secondary">Sign In</h2>
          <p className="text-[13px] text-ct-muted mt-1">Enter your SIP or account credentials</p>
        </div>

        {error && (
          <div className="text-[13px] text-ct-red text-center mb-3" role="alert">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label htmlFor="username" className="block text-[13px] text-ct-muted mb-1.5">
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="form-input"
              autoComplete="username"
              autoFocus
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-[13px] text-ct-muted mb-1.5">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="form-input"
              autoComplete="current-password"
            />
          </div>
        </div>

        <button type="submit" className="btn btn-primary btn-lg mt-6">
          Sign In
        </button>
      </form>
    </div>
  );
}
