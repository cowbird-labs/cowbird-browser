import { useState } from 'react';
import { rpc } from '../../messaging/rpc';
import type { StateInfo } from '../../messaging/protocol';
import { errorMessage } from '../util';
import { ImportForm } from './ImportForm';

export function UnlockForm({
  state,
  onDone,
}: {
  state: StateInfo;
  onDone: (s: StateInfo) => void;
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recovering, setRecovering] = useState(false);

  if (recovering) {
    return <ImportForm onDone={onDone} onCancel={() => setRecovering(false)} />;
  }

  const unlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      onDone(await rpc('unlock', { password }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    try {
      onDone(await rpc('disconnect'));
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <form className="screen" onSubmit={unlock}>
      <h1>Unlock</h1>
      <p className="muted">
        Signed in as {state.displayName || state.entityID}. Enter your unlock password.
      </p>

      <label htmlFor="pw">Unlock password</label>
      <input
        id="pw"
        type="password"
        autoFocus
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />

      {busy && <p className="spinner">Deriving your key… this takes a few seconds.</p>}
      {error && <p className="error">{error}</p>}

      <div className="actions">
        <button type="submit" className="primary" disabled={busy}>
          Unlock
        </button>
      </div>

      <div className="row between" style={{ marginTop: 16 }}>
        <button type="button" className="link" onClick={() => setRecovering(true)}>
          Restore from recovery file
        </button>
        <button type="button" className="link" onClick={() => void disconnect()}>
          Disconnect
        </button>
      </div>
    </form>
  );
}
