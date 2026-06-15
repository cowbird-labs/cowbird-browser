import { useState } from 'react';
import { rpc } from '../../messaging/rpc';
import type { StateInfo } from '../../messaging/protocol';
import { errorMessage } from '../util';

function downloadBase64(fileBase64: string, filename: string): void {
  const bin = atob(fileBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function Settings({
  onBack,
  onState,
}: {
  onBack: () => void;
  onState: (s: StateInfo) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // change password
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  // rotate key
  const [rotatePassword, setRotatePassword] = useState('');
  // export
  const [exportUnlock, setExportUnlock] = useState('');
  const [exportPassphrase, setExportPassphrase] = useState('');

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const doChangePassword = () =>
    run(async () => {
      await rpc('changePassword', { oldPassword, newPassword });
      setOldPassword('');
      setNewPassword('');
      setNotice('Unlock password changed.');
    });

  const doRotate = () =>
    run(async () => {
      if (!confirm('Rotate your key? This re-encrypts every item and re-shares to recipients. It can take a while.')) {
        return;
      }
      onState(await rpc('rotateKey', { password: rotatePassword }));
      setRotatePassword('');
      setNotice('Key rotated.');
    });

  const doExport = () =>
    run(async () => {
      const { fileBase64 } = await rpc('exportKey', {
        unlockPassword: exportUnlock,
        passphrase: exportPassphrase,
      });
      downloadBase64(fileBase64, 'cowbird-recovery.json');
      setExportUnlock('');
      setExportPassphrase('');
      setNotice('Recovery file downloaded. Store it somewhere safe.');
    });

  const lock = () => run(async () => onState(await rpc('lock')));
  const disconnect = () => run(async () => onState(await rpc('disconnect')));

  return (
    <div>
      <div className="topbar">
        <button className="iconbtn" onClick={onBack}>
          ‹ Back
        </button>
        <span className="title">Settings</span>
        <span />
      </div>
      <div className="screen">
        {error && <p className="error">{error}</p>}
        {notice && <p className="muted">{notice}</p>}

        <h2>Change unlock password</h2>
        <label htmlFor="op">Current password</label>
        <input id="op" type="password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} />
        <label htmlFor="np">New password</label>
        <input id="np" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        <div className="actions">
          <button disabled={busy || !oldPassword || !newPassword} onClick={() => void doChangePassword()}>
            Change password
          </button>
        </div>

        <h2>Export recovery file</h2>
        <p className="muted">A passphrase-protected backup of your key — the only way to recover access.</p>
        <label htmlFor="eu">Unlock password</label>
        <input id="eu" type="password" value={exportUnlock} onChange={(e) => setExportUnlock(e.target.value)} />
        <label htmlFor="ep">Export passphrase</label>
        <input id="ep" type="password" value={exportPassphrase} onChange={(e) => setExportPassphrase(e.target.value)} />
        <div className="actions">
          <button disabled={busy || !exportUnlock || !exportPassphrase} onClick={() => void doExport()}>
            Download recovery file
          </button>
        </div>

        <h2>Rotate key</h2>
        <p className="muted">For compromise recovery. Generates a new keypair and re-encrypts everything.</p>
        <label htmlFor="rp">Unlock password</label>
        <input id="rp" type="password" value={rotatePassword} onChange={(e) => setRotatePassword(e.target.value)} />
        <div className="actions">
          <button className="danger" disabled={busy || !rotatePassword} onClick={() => void doRotate()}>
            Rotate key
          </button>
        </div>

        <h2>Session</h2>
        <div className="actions">
          <button onClick={() => void lock()}>Lock</button>
          <button onClick={() => void disconnect()}>Disconnect from Vault</button>
        </div>
      </div>
    </div>
  );
}
