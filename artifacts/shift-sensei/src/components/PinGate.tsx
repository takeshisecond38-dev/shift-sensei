import { useState, useEffect, type ReactNode } from 'react';
import { setAuthTokenGetter } from '@workspace/api-client-react';

const TOKEN_KEY = 'shift_sensei_auth_token';

function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function storeToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Ignore storage errors
  }
}

async function checkAuthStatus(token: string | null): Promise<boolean> {
  try {
    const headers: HeadersInit = { 'content-type': 'application/json' };
    if (token) headers['authorization'] = `Bearer ${token}`;
    const res = await fetch('/api/auth/status', { headers });
    if (!res.ok) return false;
    const data = await res.json();
    return data.authenticated === true;
  } catch {
    return false;
  }
}

async function submitPin(pin: string): Promise<{ ok: boolean; token?: string; error?: string }> {
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pin }),
    });
    return res.json();
  } catch {
    return { ok: false, error: '接続エラー。もう一度お試しください。' };
  }
}

interface PinGateProps {
  children: ReactNode;
}

type State = 'loading' | 'locked' | 'unlocked';

export default function PinGate({ children }: PinGateProps) {
  const [state, setState] = useState<State>('loading');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const token = getStoredToken();
    if (token) {
      // Register the token getter so all API calls include it
      setAuthTokenGetter(() => token);
    }
    checkAuthStatus(token).then((authenticated) => {
      setState(authenticated ? 'unlocked' : 'locked');
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pin) return;
    setSubmitting(true);
    setError('');
    try {
      const result = await submitPin(pin);
      if (result.ok && result.token) {
        storeToken(result.token);
        setAuthTokenGetter(() => result.token!);
        setState('unlocked');
      } else {
        setError(result.error ?? 'PINが正しくありません');
        setPin('');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (state === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (state === 'unlocked') {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-6">
      <div className="w-full max-w-xs space-y-8">
        <div className="text-center space-y-1">
          <div className="text-4xl mb-3">📅</div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">シフト先生</h1>
          <p className="text-sm text-muted-foreground">PINを入力してください</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="PIN"
            autoFocus
            disabled={submitting}
            className="w-full h-14 text-center text-2xl tracking-[0.5em] border border-input rounded-xl bg-card text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition"
          />

          {error && (
            <p className="text-sm text-destructive text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={!pin || submitting}
            className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-semibold text-base disabled:opacity-40 transition active:scale-95"
          >
            {submitting ? '確認中…' : 'ログイン'}
          </button>
        </form>
      </div>
    </div>
  );
}
