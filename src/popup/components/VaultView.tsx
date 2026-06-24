import { useCallback, useEffect, useState } from 'react';
import { rpc } from '../../messaging/rpc';
import type { ItemSummary, Label, StateInfo } from '../../messaging/protocol';
import { errorMessage } from '../util';
import { CurrentSite } from './CurrentSite';
import { ItemList } from './ItemList';
import { ItemDetail } from './ItemDetail';
import { ItemEditor } from './ItemEditor';
import { Settings } from './Settings';
import { Generator } from './Generator';
import { LabelManager } from './LabelManager';
import { Icon } from './Icon';
import { loadUiState, saveUiState, type PopupView } from '../uiState';

export function VaultView({
  state,
  onState,
}: {
  state: StateInfo;
  onState: (s: StateInfo) => void;
}) {
  const [items, setItems] = useState<ItemSummary[] | null>(null);
  const [labels, setLabels] = useState<Label[]>([]);
  // `null` view = still restoring the persisted screen on mount (issue #8).
  const [view, setView] = useState<PopupView | null>(null);
  const [search, setSearch] = useState('');
  // Organization filters compose with search (intersection). Kept ephemeral
  // (not persisted) so reopening the popup starts from an unfiltered list.
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [labelFilter, setLabelFilter] = useState('');
  const [error, setError] = useState<string | null>(null);

  const loadItems = useCallback(async () => {
    setError(null);
    try {
      const { items, labels } = await rpc('listItems');
      setItems(items);
      setLabels(labels);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  const toggleFavorite = useCallback(
    async (it: ItemSummary) => {
      // Optimistically flip in place so the star responds immediately; reload
      // afterward to re-sort and reconcile with the persisted overlay.
      setItems((cur) =>
        cur
          ? cur.map((x) =>
              x.id === it.id && x.shared === it.shared ? { ...x, favorite: !x.favorite } : x,
            )
          : cur,
      );
      try {
        await rpc('toggleFavorite', { id: it.id });
      } catch (e) {
        setError(errorMessage(e));
      }
      void loadItems();
    },
    [loadItems],
  );

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  // Restore the last popup screen (and search) so reopening lands where the user
  // left off rather than on the default list.
  useEffect(() => {
    void loadUiState().then((s) => {
      setView(s.view);
      setSearch(s.search);
    });
  }, []);

  useEffect(() => {
    if (view) void saveUiState({ view, search });
  }, [view, search]);

  // A restored detail view may point at an item that no longer exists (deleted,
  // or a different vault since it was saved). Fall back to the list rather than
  // render a dead detail screen.
  useEffect(() => {
    if (
      view?.kind === 'detail' &&
      items &&
      !items.some((it) => it.id === view.id && it.shared === view.shared)
    ) {
      setView({ kind: 'list' });
    }
  }, [view, items]);

  // If the label backing the active filter is deleted, drop back to "all labels"
  // so the list doesn't silently show nothing.
  useEffect(() => {
    if (labelFilter && !labels.some((l) => l.id === labelFilter)) setLabelFilter('');
  }, [labels, labelFilter]);

  const backToList = () => {
    setView({ kind: 'list' });
    void loadItems();
  };

  if (view === null) {
    return <p className="screen muted">Loading…</p>;
  }

  if (view.kind === 'settings') {
    return <Settings onBack={() => setView({ kind: 'list' })} onState={onState} />;
  }
  if (view.kind === 'new') {
    return <ItemEditor onCancel={() => setView({ kind: 'list' })} onSaved={backToList} />;
  }
  if (view.kind === 'generator') {
    return <Generator onClose={() => setView({ kind: 'list' })} />;
  }
  if (view.kind === 'labels') {
    return <LabelManager onBack={backToList} />;
  }
  if (view.kind === 'detail') {
    return (
      <ItemDetail
        id={view.id}
        shared={view.shared}
        labels={labels}
        onBack={backToList}
        afterChange={() => void loadItems()}
      />
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
            <Icon name="refresh" />
          </button>
          <button className="iconbtn" title="Add item" onClick={() => setView({ kind: 'new' })}>
            <Icon name="add" />
          </button>
          <button
            className="iconbtn"
            title="Password generator"
            onClick={() => setView({ kind: 'generator' })}
          >
            <Icon name="dice" />
          </button>
          <button className="iconbtn" title="Manage labels" onClick={() => setView({ kind: 'labels' })}>
            <Icon name="tag" />
          </button>
          <button className="iconbtn" title="Settings" onClick={() => setView({ kind: 'settings' })}>
            <Icon name="settings" />
          </button>
          <button className="iconbtn" title="Lock" onClick={() => void lock()}>
            <Icon name="lock" />
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
        labels={labels}
        search={search}
        onSearchChange={setSearch}
        favoriteOnly={favoriteOnly}
        onFavoriteOnlyChange={setFavoriteOnly}
        labelFilter={labelFilter}
        onLabelFilterChange={setLabelFilter}
        onSelect={(it) => setView({ kind: 'detail', id: it.id, shared: it.shared })}
        onToggleFavorite={(it) => void toggleFavorite(it)}
      />
      <p className="muted" style={{ padding: '8px 12px' }}>
        {state.displayName ? `Signed in as ${state.displayName}` : null}
      </p>
    </div>
  );
}
