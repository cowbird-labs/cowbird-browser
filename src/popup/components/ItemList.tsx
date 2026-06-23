import type { ItemSummary } from '../../messaging/protocol';
import { typeLabel } from '../itemSchema';

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
  search,
  onSearchChange,
  onSelect,
}: {
  items: ItemSummary[] | null;
  search: string;
  onSearchChange: (q: string) => void;
  onSelect: (it: ItemSummary) => void;
}) {
  if (!items) {
    return <p className="screen muted">Loading…</p>;
  }

  const filtered = items
    .filter((it) => matches(it, search))
    .sort((a, b) => (a.title || '').localeCompare(b.title || ''));

  return (
    <>
      <div className="search-bar">
        <input
          className="search"
          placeholder="Search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
      {filtered.length === 0 ? (
        <p className="screen muted">No items.</p>
      ) : (
        <ul className="list">
          {filtered.map((it) => (
            <li key={(it.shared ? 's:' : 'o:') + it.id}>
              <button onClick={() => onSelect(it)}>
                <div className="item-title">
                  {it.title || '(untitled)'}
                  {it.shared && <span className="badge">shared</span>}
                </div>
                <div className="item-sub">{subtitle(it)}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
