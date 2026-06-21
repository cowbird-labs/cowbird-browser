import { useCallback, useEffect, useState } from 'react';
import { rpc } from '../../messaging/rpc';
import type { ItemSummary, StateInfo } from '../../messaging/protocol';
import { errorMessage } from '../util';
import { CurrentSite } from './CurrentSite';
import { ItemList } from './ItemList';
import { ItemDetail } from './ItemDetail';
import { ItemEditor } from './ItemEditor';
import { Settings } from './Settings';
import { Generator } from './Generator';

type View =
  | { kind: 'list' }
  | { kind: 'detail'; id: string; shared: boolean }
  | { kind: 'new' }
  | { kind: 'generator' }
  | { kind: 'settings' };

export function VaultView({
  state,
  onState,
}: {
  state: StateInfo;
  onState: (s: StateInfo) => void;
}) {
  const [items, setItems] = useState<ItemSummary[] | null>(null);
  const [view, setView] = useState<View>({ kind: 'list' });
  const [error, setError] = useState<string | null>(null);

  const loadItems = useCallback(async () => {
    setError(null);
    try {
      const { items } = await rpc('listItems');
      setItems(items);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const backToList = () => {
    setView({ kind: 'list' });
    void loadItems();
  };

  if (view.kind === 'settings') {
    return <Settings onBack={() => setView({ kind: 'list' })} onState={onState} />;
  }
  if (view.kind === 'new') {
    return <ItemEditor onCancel={() => setView({ kind: 'list' })} onSaved={backToList} />;
  }
  if (view.kind === 'generator') {
    return <Generator onClose={() => setView({ kind: 'list' })} />;
  }
  if (view.kind === 'detail') {
    return (
      <ItemDetail id={view.id} shared={view.shared} onBack={backToList} afterChange={() => void loadItems()} />
    );
  }

  const lock = async () => {
    onState(await rpc('lock'));
  };

  return (
    <div>
      <div className="topbar">
        <span className="title">Cowbird</span>
        <div className="row">
          <button className="iconbtn" title="Refresh" onClick={() => void loadItems()}>
            ⟳
          </button>
          <button className="iconbtn" title="Add item" onClick={() => setView({ kind: 'new' })}>
            ＋
          </button>
          <button
            className="iconbtn"
            title="Password generator"
            onClick={() => setView({ kind: 'generator' })}
          >
            🎲
          </button>
          <button className="iconbtn" title="Settings" onClick={() => setView({ kind: 'settings' })}>
            ⚙
          </button>
          <button className="iconbtn" title="Lock" onClick={() => void lock()}>
            🔒
          </button>
        </div>
      </div>
      {error && <p className="error screen">{error}</p>}
      {items && (
        <CurrentSite
          items={items}
          onSelect={(it) => setView({ kind: 'detail', id: it.id, shared: it.shared })}
        />
      )}
      <ItemList
        items={items}
        onSelect={(it) => setView({ kind: 'detail', id: it.id, shared: it.shared })}
      />
      <p className="muted" style={{ padding: '8px 12px' }}>
        {state.displayName ? `Signed in as ${state.displayName}` : null}
      </p>
    </div>
  );
}
