import { useState } from 'react';
import { rpc } from '../../messaging/rpc';
import type { StateInfo } from '../../messaging/protocol';
import { errorMessage } from '../util';

/**
 * ImportForm restores an identity from a passphrase-protected recovery file and
 * sets a new unlock password. Reached from the unlock screen. If the recovered
 * key differs from the published one it retries with force after confirmation.
 */
export function ImportForm({
  onDone,
  onCancel,
}: {
  onDone: (s: StateInfo) => void;
  onCancel: () => void;
}) {
  const [fileText, setFileText] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setFileText(await file.text());
  };

  const submit = async (force: boolean) => {
    setError(null);
    setBusy(true);
    try {
      onDone(await rpc('importKey', { fileText, passphrase, newPassword, force }));
    } catch (err) {
      const message = errorMessage(err);
      if (message.includes('different identity') && !force) {
        if (confirm('This recovery file is for a different identity. Import anyway? This will overwrite the stored identity.')) {
          await submit(true);
          return;
        }
      }
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="screen"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(false);
      }}
    >
      <h1>Restore from recovery file</h1>

      <label htmlFor="file">Recovery file (cowbird-recovery.json)</label>
      <input id="file" type="file" accept="application/json,.json" onChange={(e) => void readFile(e.target.files?.[0])} />

      <label htmlFor="pp">Export passphrase</label>
      <input id="pp" type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />

      <label htmlFor="np">New unlock password</label>
      <input id="np" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />

      {busy && <p className="spinner">Working…</p>}
      {error && <p className="error">{error}</p>}

      <div className="actions">
        <button type="submit" className="primary" disabled={busy || !fileText}>
          Restore
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
