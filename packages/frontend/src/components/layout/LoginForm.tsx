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
    <form
      onSubmit={handleSubmit}
      className="glass-panel p-8 w-full max-w-sm space-y-6"
    >
      <div className="text-center">
        <h1 className="text-2xl font-bold text-ct-accent">CallTools</h1>
        <p className="text-sm text-ct-muted mt-1">V2 Beta</p>
      </div>

      {error && (
        <div className="text-sm text-ct-red bg-ct-red/10 rounded px-3 py-2" role="alert">
          {error}
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label htmlFor="username" className="block text-sm text-ct-muted mb-1">
            Username
          </label>
          <input
            id="username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full px-3 py-2 bg-ct-bg border border-ct-border rounded text-ct-text focus:outline-none focus:border-ct-accent transition-colors"
            autoComplete="username"
            autoFocus
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm text-ct-muted mb-1">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 bg-ct-bg border border-ct-border rounded text-ct-text focus:outline-none focus:border-ct-accent transition-colors"
            autoComplete="current-password"
          />
        </div>
      </div>

      <button
        type="submit"
        className="w-full py-2 px-4 bg-ct-blue hover:bg-ct-accent text-white font-medium rounded transition-colors"
      >
        Sign In
      </button>
    </form>
  );
}
