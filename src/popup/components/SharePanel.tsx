import { useEffect, useState } from 'react';
import { rpc } from '../../messaging/rpc';
import type { DirectoryEntry, ShareRecipient } from '../../messaging/protocol';
import { errorMessage } from '../util';

export function SharePanel({
  itemId,
  recipients,
  afterChange,
}: {
  itemId: string;
  recipients: ShareRecipient[];
  afterChange: () => void;
}) {
  const [directory, setDirectory] = useState<DirectoryEntry[]>([]);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    rpc('directory')
      .then((r) => setDirectory(r.entries.filter((e) => !e.isSelf)))
      .catch((e) => setError(errorMessage(e)));
  }, []);

  const sharedWith = new Set(recipients.map((r) => r.recipientID));
  const candidates = directory.filter((e) => !sharedWith.has(e.entityID));

  const share = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await rpc('shareItem', { itemId, recipientId: selected });
      setSelected('');
      afterChange();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (r: ShareRecipient) => {
    setBusy(true);
    setError(null);
    try {
      await rpc('revokeShare', { shareId: r.shareID, recipientId: r.recipientID });
      afterChange();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h2>Sharing</h2>
      {recipients.length === 0 ? (
        <p className="muted">Not shared with anyone.</p>
      ) : (
        <ul className="list">
          {recipients.map((r) => (
            <li key={r.shareID}>
              <div className="row between" style={{ padding: '8px 0' }}>
                <span>{r.recipientName}</span>
                <button className="link danger" disabled={busy} onClick={() => void revoke(r)}>
                  Revoke
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="row">
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">Share with…</option>
          {candidates.map((e) => (
            <option key={e.entityID} value={e.entityID}>
              {e.name}
            </option>
          ))}
        </select>
        <button disabled={busy || !selected} onClick={() => void share()}>
          Share
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
