import { useState, useEffect, type FormEvent } from 'react';
import { useAuth } from '../../hooks/useAuth';

const SIGNUP_API = '/calltools-signup.php';

export function LoginForm() {
  const [tab, setTab] = useState<'login' | 'signup'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login } = useAuth();

  // Signup state
  const [signupForm, setSignupForm] = useState({
    firstname: '', lastname: '', email: '', username: '', password: '', password2: '', id_plan: 0, captcha_answer: '',
  });
  const [signupError, setSignupError] = useState('');
  const [signupLoading, setSignupLoading] = useState(false);
  const [signupSuccess, setSignupSuccess] = useState<{ username: string; sip_extension: string } | null>(null);
  const [plans, setPlans] = useState<{ id: number; name: string }[]>([]);
  const [captcha, setCaptcha] = useState('Loading...');

  // Load plans and captcha when signup tab is shown
  useEffect(() => {
    if (tab === 'signup') {
      loadPlans();
      loadCaptcha();
    }
  }, [tab]);

  async function loadPlans() {
    try {
      const res = await fetch(SIGNUP_API + '?action=plans');
      const data = await res.json();
      setPlans(data.plans || []);
    } catch { setPlans([]); }
  }

  async function loadCaptcha() {
    try {
      const res = await fetch(SIGNUP_API + '?action=captcha', { credentials: 'include' });
      const data = await res.json();
      setCaptcha(data.challenge || '?');
    } catch { setCaptcha('Error'); }
  }

  const handleLogin = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!username.trim() || !password.trim()) {
      setError('Please enter both username and password.');
      return;
    }
    login(username.trim(), password);
  };

  const handleSignup = async (e: FormEvent) => {
    e.preventDefault();
    setSignupError('');
    setSignupLoading(true);

    try {
      const res = await fetch(SIGNUP_API + '?action=signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(signupForm),
      });
      const data = await res.json();
      if (data.success) {
        setSignupSuccess({ username: data.username, sip_extension: data.sip_extension });
        setUsername(data.username);
        setPassword('');
      } else {
        setSignupError(data.error || 'Signup failed.');
        loadCaptcha();
      }
    } catch {
      setSignupError('Network error. Please try again.');
      loadCaptcha();
    }
    setSignupLoading(false);
  };

  const updateSignup = (field: string, value: string | number) => {
    setSignupForm(prev => ({ ...prev, [field]: value }));
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      {/* Header */}
      <div className="header-gradient w-full fixed top-0 left-0 right-0 px-6 py-3.5 z-50">
        <h1 className="text-xl font-semibold text-ct-accent tracking-wide">
          Call Tools <span className="beta-badge">BETA</span>{' '}
          <span className="text-ct-muted font-normal text-base">/ Cyborg Telecom</span>
        </h1>
      </div>

      <div
        className="w-full max-w-[380px]"
        style={{
          background: 'rgba(22, 27, 34, 0.85)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          border: '1px solid rgba(33, 38, 45, 0.6)',
          borderRadius: 16,
          boxShadow: '0 8px 32px rgba(0,0,0,0.3), 0 0 1px rgba(255,255,255,0.05)',
          padding: 0,
          overflow: 'hidden',
        }}
      >
        {/* Auth Tabs */}
        {/* V1 line 158-170: auth-tabs with rounded border container */}
        <div className="flex mx-10 mt-5 mb-0 rounded-lg overflow-hidden border border-ct-border-solid">
          <button
            onClick={() => { setTab('login'); setSignupSuccess(null); }}
            className={`flex-1 py-2.5 text-center text-sm font-semibold transition-colors ${
              tab === 'login' ? 'bg-ct-blue text-white' : 'bg-ct-bg text-ct-muted hover:bg-ct-surface-solid hover:text-ct-text-secondary'
            }`}
          >
            Log In
          </button>
          <button
            onClick={() => setTab('signup')}
            className={`flex-1 py-2.5 text-center text-sm font-semibold transition-colors ${
              tab === 'signup' ? 'bg-ct-blue text-white' : 'bg-ct-bg text-ct-muted hover:bg-ct-surface-solid hover:text-ct-text-secondary'
            }`}
          >
            Sign Up
          </button>
        </div>

        <div className="p-10">
          {/* ── Login Pane ── */}
          {tab === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="text-center mb-2">
                <h2 className="text-lg font-semibold text-ct-text-secondary">Log In</h2>
                <p className="text-[13px] text-ct-muted mt-1">Log in with your SIP, User, or Admin credentials</p>
              </div>

              {error && <div className="text-[13px] text-ct-red text-center">{error}</div>}

              <div>
                <label className="block text-[13px] text-ct-muted mb-1.5">Username</label>
                <input type="text" value={username} onChange={e => setUsername(e.target.value)} className="form-input" autoComplete="username" autoFocus />
              </div>
              <div>
                <label className="block text-[13px] text-ct-muted mb-1.5">Password</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="form-input" autoComplete="current-password" />
              </div>
              <button type="submit" className="btn btn-primary btn-lg">Log In</button>
              <p className="text-center text-[13px] text-ct-muted mt-3">
                Don't have an account?{' '}
                <a href="#" onClick={e => { e.preventDefault(); setTab('signup'); }} className="text-ct-accent hover:underline">Sign Up</a>
              </p>
            </form>
          )}

          {/* ── Signup Pane ── */}
          {tab === 'signup' && !signupSuccess && (
            <form onSubmit={handleSignup} className="space-y-3">
              <p className="text-[13px] text-ct-muted text-center mb-1">Create your account to get started</p>

              {signupError && <div className="text-[13px] text-ct-red text-center">{signupError}</div>}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[13px] text-ct-muted mb-1">First Name</label>
                  <input type="text" value={signupForm.firstname} onChange={e => updateSignup('firstname', e.target.value)}
                    className="form-input !text-sm" placeholder="First name" autoComplete="given-name" />
                </div>
                <div>
                  <label className="block text-[13px] text-ct-muted mb-1">Last Name</label>
                  <input type="text" value={signupForm.lastname} onChange={e => updateSignup('lastname', e.target.value)}
                    className="form-input !text-sm" placeholder="Last name" autoComplete="family-name" />
                </div>
              </div>

              <div>
                <label className="block text-[13px] text-ct-muted mb-1">Email</label>
                <input type="email" value={signupForm.email} onChange={e => updateSignup('email', e.target.value)}
                  className="form-input !text-sm" placeholder="you@example.com" autoComplete="email" />
              </div>

              <div>
                <label className="block text-[13px] text-ct-muted mb-1">Username</label>
                <input type="text" value={signupForm.username} onChange={e => updateSignup('username', e.target.value)}
                  className="form-input !text-sm" placeholder="5-20 characters" autoComplete="off" />
              </div>

              <div>
                <label className="block text-[13px] text-ct-muted mb-1">Password</label>
                <input type="password" value={signupForm.password} onChange={e => updateSignup('password', e.target.value)}
                  className="form-input !text-sm" placeholder="6+ characters" autoComplete="new-password" />
              </div>

              <div>
                <label className="block text-[13px] text-ct-muted mb-1">Confirm Password</label>
                <input type="password" value={signupForm.password2} onChange={e => updateSignup('password2', e.target.value)}
                  className="form-input !text-sm" placeholder="Re-enter password" autoComplete="new-password" />
              </div>

              <div>
                <label className="block text-[13px] text-ct-muted mb-1">Plan</label>
                <select value={signupForm.id_plan} onChange={e => updateSignup('id_plan', parseInt(e.target.value) || 0)}
                  className="form-input !text-sm">
                  <option value={0}>-- Select a plan --</option>
                  {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-[13px] text-ct-muted mb-1">Verify you're human</label>
                <div className="flex items-center gap-2.5">
                  <span className="font-mono text-base font-bold text-[#f0e68c] bg-ct-surface-solid px-3 py-1.5 rounded-md border border-ct-border-solid whitespace-nowrap">
                    {captcha}
                  </span>
                  <input type="text" value={signupForm.captcha_answer} onChange={e => updateSignup('captcha_answer', e.target.value)}
                    className="form-input !text-sm" placeholder="Answer" style={{ width: 100 }} autoComplete="off" />
                  <button type="button" onClick={loadCaptcha} className="text-ct-muted hover:text-ct-text-secondary text-xs">↻</button>
                </div>
              </div>

              <button type="submit" disabled={signupLoading} className="btn btn-primary btn-lg">
                {signupLoading ? 'Creating account...' : 'Create Account'}
              </button>

              <p className="text-center text-[13px] text-ct-muted">
                Already have an account?{' '}
                <a href="#" onClick={e => { e.preventDefault(); setTab('login'); }} className="text-ct-accent hover:underline">Log In</a>
              </p>
            </form>
          )}

          {/* ── Signup Success ── */}
          {tab === 'signup' && signupSuccess && (
            <div className="text-center space-y-4">
              <h3 className="text-lg font-semibold text-ct-green">Account Created!</h3>
              <p className="text-[13px] text-ct-muted">Your account is ready. Here are your credentials:</p>
              <div className="bg-ct-bg border border-ct-border-solid rounded-lg p-4 text-left space-y-2">
                <div className="flex justify-between text-[13px] py-1 border-b border-ct-border-solid">
                  <span className="text-ct-muted">Username</span>
                  <span className="text-ct-accent font-mono font-semibold">{signupSuccess.username}</span>
                </div>
                <div className="flex justify-between text-[13px] py-1">
                  <span className="text-ct-muted">SIP Extension</span>
                  <span className="text-ct-accent font-mono font-semibold">{signupSuccess.sip_extension}</span>
                </div>
              </div>
              <p className="text-xs text-ct-muted">Use your username and password to log in.</p>
              <button onClick={() => { setTab('login'); setSignupSuccess(null); }} className="btn btn-primary btn-lg">
                Go to Login
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
