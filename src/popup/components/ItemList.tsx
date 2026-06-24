import type { ItemSummary, Label } from '../../messaging/protocol';
import { typeLabel } from '../itemSchema';
import { LabelChips } from './LabelChips';
import { Icon } from './Icon';

function subtitle(it: ItemSummary): string {
  if (it.shared) return `Shared by ${it.ownerName ?? 'someone'}`;
  if (it.type === 'login' && it.username) return it.username;
  return typeLabel(it.type);
}

function matches(it: ItemSummary, q: string): boolean {
  if (!q) return true;
  const haystack = [it.title, it.username, it.ownerName, ...(it.urls ?? [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(q.toLowerCase());
}

export function ItemList({
  items,
  labels,
  search,
  onSearchChange,
  favoriteOnly,
  onFavoriteOnlyChange,
  labelFilter,
  onLabelFilterChange,
  onSelect,
  onToggleFavorite,
}: {
  items: ItemSummary[] | null;
  labels: Label[];
  search: string;
  onSearchChange: (q: string) => void;
  favoriteOnly: boolean;
  onFavoriteOnlyChange: (v: boolean) => void;
  labelFilter: string; // '' = all labels
  onLabelFilterChange: (id: string) => void;
  onSelect: (it: ItemSummary) => void;
  onToggleFavorite: (it: ItemSummary) => void;
}) {
  if (!items) {
    return <p className="screen muted">Loading…</p>;
  }

  // Compose filters (intersection): text search AND favorites AND label, then
  // sort favorites ahead of the rest, falling back to title order.
  const filtered = items
    .filter((it) => matches(it, search))
    .filter((it) => !favoriteOnly || it.favorite)
    .filter((it) => !labelFilter || it.labels.includes(labelFilter))
    .sort((a, b) => {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      return (a.title || '').localeCompare(b.title || '');
    });

  const labelById = new Map(labels.map((l) => [l.id, l]));

  return (
    <>
      <div className="search-bar">
        <input
          className="search"
          placeholder="Search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        <button
          type="button"
          className={`iconbtn star${favoriteOnly ? ' on' : ''}`}
          title={favoriteOnly ? 'Showing favorites' : 'Show favorites only'}
          aria-pressed={favoriteOnly}
          onClick={() => onFavoriteOnlyChange(!favoriteOnly)}
        >
          <Icon name={favoriteOnly ? 'star' : 'star-outline'} size={16} />
        </button>
        {labels.length > 0 && (
          <select
            className="label-filter"
            value={labelFilter}
            onChange={(e) => onLabelFilterChange(e.target.value)}
            title="Filter by label"
          >
            <option value="">All labels</option>
            {labels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        )}
      </div>
      {filtered.length === 0 ? (
        <p className="screen muted">No items.</p>
      ) : (
        <ul className="list">
          {filtered.map((it) => (
            <li key={(it.shared ? 's:' : 'o:') + it.id} className="item-row">
              <button className="item-main" onClick={() => onSelect(it)}>
                <div className="item-title">
                  {it.title || '(untitled)'}
                  {it.shared && <span className="badge">shared</span>}
                </div>
                <div className="item-sub">{subtitle(it)}</div>
                {it.labels.length > 0 && (
                  <LabelChips labelIds={it.labels} labelById={labelById} />
                )}
              </button>
              <button
                type="button"
                className={`iconbtn star${it.favorite ? ' on' : ''}`}
                title={it.favorite ? 'Unfavorite' : 'Favorite'}
                aria-pressed={it.favorite}
                onClick={() => onToggleFavorite(it)}
              >
                <Icon name={it.favorite ? 'star' : 'star-outline'} size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
