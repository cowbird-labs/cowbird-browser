import { useEffect, useRef, useState } from 'react';
import { rpc } from '../../messaging/rpc';
import type { StateInfo, TransferFormat } from '../../messaging/protocol';
import { errorMessage } from '../util';
import { Icon } from './Icon';

function downloadBase64(fileBase64: string, filename: string): void {
  const bin = atob(fileBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// readAsBase64 reads a picked file and returns its contents base64-encoded, for
// handing the raw bytes to the worker over the JSON RPC channel.
function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const res = r.result as string; // data: URL
      const comma = res.indexOf(',');
      resolve(comma >= 0 ? res.slice(comma + 1) : res);
    };
    r.onerror = () => reject(r.error ?? new Error('file read failed'));
    r.readAsDataURL(file);
  });
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
  // export recovery file
  const [exportUnlock, setExportUnlock] = useState('');
  const [exportPassphrase, setExportPassphrase] = useState('');
  // item import/export
  const [formats, setFormats] = useState<TransferFormat[]>([]);
  const [format, setFormat] = useState('cowbird');
  const importInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void (async () => {
      try {
        const { formats } = await rpc('listFormats');
        setFormats(formats);
      } catch {
        // Format list is non-critical; the section just won't render.
      }
    })();
  }, []);

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

  const formatName = (id: string) => formats.find((f) => f.id === id)?.name ?? id;

  const doExportItems = () =>
    run(async () => {
      if (
        !confirm(
          `Export your items as ${formatName(format)}?\n\n` +
            'The file will contain your passwords and secrets IN CLEAR TEXT — it is ' +
            'not encrypted or passphrase-protected. Store or delete it carefully.',
        )
      ) {
        return;
      }
      const { fileBase64, filename } = await rpc('exportItems', { format });
      downloadBase64(fileBase64, filename);
      setNotice(`Exported items to ${filename}.`);
    });

  const onImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    void run(async () => {
      const dataBase64 = await readAsBase64(file);
      const { imported, skipped } = await rpc('importItems', { format, dataBase64 });
      setNotice(`Imported ${imported} item(s)${skipped ? `, skipped ${skipped}` : ''}.`);
    });
  };

  const doRemoveDuplicates = () =>
    run(async () => {
      const { count } = await rpc('removeDuplicates', { dryRun: true });
      if (count === 0) {
        setNotice('No duplicate items found.');
        return;
      }
      if (!confirm(`Found ${count} duplicate item(s). Remove them, keeping one of each?`)) {
        return;
      }
      const { count: removed } = await rpc('removeDuplicates', { dryRun: false });
      setNotice(`Removed ${removed} duplicate item(s).`);
    });

  const lock = () => run(async () => onState(await rpc('lock')));
  const disconnect = () => run(async () => onState(await rpc('disconnect')));

  return (
    <div>
      <div className="topbar">
        <button className="iconbtn" onClick={onBack}>
          <Icon name="back" size={14} /> Back
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

        <h2>Import / export items</h2>
        <p className="muted">
          Move items in and out in bulk. Exported files are <strong>unencrypted</strong> plain text.
        </p>
        <label htmlFor="fmt">Format</label>
        <select id="fmt" value={format} onChange={(e) => setFormat(e.target.value)}>
          {formats.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <input
          ref={importInput}
          type="file"
          style={{ display: 'none' }}
          onChange={onImportFile}
        />
        <div className="actions">
          <button disabled={busy || !formats.length} onClick={() => void doExportItems()}>
            Export items
          </button>
          <button disabled={busy || !formats.length} onClick={() => importInput.current?.click()}>
            Import items
          </button>
        </div>

        <h2>Remove duplicates</h2>
        <p className="muted">Find owned items with identical contents and keep one of each.</p>
        <div className="actions">
          <button disabled={busy} onClick={() => void doRemoveDuplicates()}>
            Remove duplicate items
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
