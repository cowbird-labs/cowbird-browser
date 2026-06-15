import { useEffect, useState } from 'react';
import { rpc } from '../../messaging/rpc';
import type { AuthMethodInfo, StateInfo } from '../../messaging/protocol';
import { errorMessage } from '../util';

export function ConnectForm({
  state,
  onDone,
  onReconfigure,
}: {
  state: StateInfo;
  onDone: (s: StateInfo) => void;
  onReconfigure: () => void;
}) {
  const [method, setMethod] = useState<AuthMethodInfo | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    rpc('getAuthMethods')
      .then((methods) => {
        setMethod(methods.find((m) => m.id === state.config?.authMethodId) ?? null);
      })
      .catch((e) => setError(errorMessage(e)));
  }, [state.config?.authMethodId]);

  const connect = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      onDone(await rpc('connect', values));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="screen" onSubmit={connect}>
      <h1>Sign in to Vault</h1>
      <p className="muted">{state.config?.address}</p>

      {method?.fields.map((field) => (
        <div key={field.key}>
          <label htmlFor={field.key}>{field.label}</label>
          <input
            id={field.key}
            type={field.secret ? 'password' : 'text'}
            value={values[field.key] ?? ''}
            onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
          />
        </div>
      ))}

      {error && <p className="error">{error}</p>}

      <div className="actions">
        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Connecting…' : 'Connect'}
        </button>
        <button type="button" onClick={onReconfigure}>
          Settings
        </button>
      </div>
    </form>
  );
}
