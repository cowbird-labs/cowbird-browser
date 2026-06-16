import { useEffect, useState } from 'react';
import type { ItemSummary } from '../../messaging/protocol';
import { getActiveTab, hostMatches, type ActiveTab } from '../autofill';

/**
 * CurrentSite surfaces login items matching the active tab's host at the top of
 * the popup. Clicking one opens its detail view (where Fill / the live TOTP code
 * live); no secrets are fetched here.
 */
export function CurrentSite({
  items,
  onSelect,
}: {
  items: ItemSummary[];
  onSelect: (it: ItemSummary) => void;
}) {
  const [tab, setTab] = useState<ActiveTab | null>(null);

  useEffect(() => {
    getActiveTab()
      .then(setTab)
      .catch(() => setTab(null));
  }, []);

  if (!tab) return null;

  const matches = items.filter(
    (it) => !it.shared && it.type === 'login' && (it.urls ?? []).some((u) => hostMatches(u, tab.host)),
  );
  if (matches.length === 0) return null;

  return (
    <div className="current-site">
      <div className="muted current-site-head">For {tab.host}</div>
      <ul className="list">
        {matches.map((it) => (
          <li key={it.id}>
            <button onClick={() => onSelect(it)}>
              <div className="item-title">{it.title || '(untitled)'}</div>
              <div className="item-sub">{it.username}</div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
