import { useCallback, useEffect, useState } from 'react';
import { rpc } from '../../messaging/rpc';
import type { Label } from '../../messaging/protocol';
import { errorMessage } from '../util';
import { Icon } from './Icon';
import { ColorField } from './ColorField';

const DEFAULT_COLOR = '#3b82f6';

export function LabelManager({ onBack }: { onBack: () => void }) {
  const [labels, setLabels] = useState<Label[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(DEFAULT_COLOR);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { labels } = await rpc('listLabels');
      setLabels(labels);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (op: () => Promise<unknown>) => {
    setError(null);
    try {
      await op();
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    await run(() => rpc('addLabel', { name, color: newColor }));
    setNewName('');
    setNewColor(DEFAULT_COLOR);
  };

  // Recolor optimistically: patch local state synchronously so the controlled
  // color input reflects the pick immediately (otherwise React snaps it back to
  // the old value on re-render before the async save returns), then persist.
  const recolor = (id: string, color: string) => {
    setLabels((cur) => (cur ? cur.map((l) => (l.id === id ? { ...l, color } : l)) : cur));
    void rpc('recolorLabel', { labelId: id, color }).catch((e) => setError(errorMessage(e)));
  };

  return (
    <div>
      <div className="topbar">
        <button className="iconbtn" onClick={onBack}>
          <Icon name="back" size={14} /> Back
        </button>
        <span className="title">Labels</span>
        <span />
      </div>
      <div className="screen">
        {error && <p className="error">{error}</p>}

        <div className="card">
          <div className="field">
            <ColorField value={newColor} onChange={setNewColor} />
            <input
              className="search field-main"
              placeholder="New label name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void create();
              }}
            />
            <button className="primary" disabled={!newName.trim()} onClick={() => void create()}>
              Add
            </button>
          </div>
        </div>

        {labels === null ? (
          <p className="muted">Loading…</p>
        ) : labels.length === 0 ? (
          <p className="muted">No labels yet. Create one above.</p>
        ) : (
          <div className="card">
            {labels.map((l) => (
              <div className="field" key={l.id}>
                <ColorField value={l.color || DEFAULT_COLOR} onChange={(c) => recolor(l.id, c)} />
                <input
                  className="search field-main"
                  defaultValue={l.name}
                  onBlur={(e) => {
                    const name = e.target.value.trim();
                    if (name && name !== l.name) void run(() => rpc('renameLabel', { labelId: l.id, name }));
                  }}
                />
                <button
                  className="iconbtn danger"
                  title="Delete label"
                  onClick={() => {
                    if (confirm(`Delete label "${l.name}"? It will be removed from all items.`))
                      void run(() => rpc('deleteLabel', { labelId: l.id }));
                  }}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
