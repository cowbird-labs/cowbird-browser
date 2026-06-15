import { useEffect, useState } from 'react';
import { rpc } from '../../messaging/rpc';
import type { ItemSummary } from '../../messaging/protocol';
import { getActiveTab, fillActiveTab, hostMatches, type ActiveTab } from '../autofill';
import { errorMessage } from '../util';

/**
 * CurrentSite surfaces login items matching the active tab's host with a Fill
 * button. The password is fetched from the worker only when Fill is clicked, then
 * sent straight to the page's content script.
 */
export function CurrentSite({ items }: { items: ItemSummary[] }) {
  const [tab, setTab] = useState<ActiveTab | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  const fill = async (it: ItemSummary) => {
    setBusy(true);
    setStatus(null);
    try {
      const detail = await rpc('getItem', { id: it.id, shared: false });
      const data = detail.content.data as { username?: string; password?: string };
      const ok = await fillActiveTab(tab.id, data.username ?? '', data.password ?? '');
      if (ok) {
        window.close();
      } else {
        setStatus('No login field found on this page. Reload the page and try again.');
      }
    } catch (e) {
      setStatus(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="current-site">
      <div className="muted current-site-head">For {tab.host}</div>
      <ul className="list">
        {matches.map((it) => (
          <li key={it.id}>
            <div className="row between" style={{ padding: '8px 12px' }}>
              <div>
                <div className="item-title">{it.title || '(untitled)'}</div>
                <div className="item-sub">{it.username}</div>
              </div>
              <button className="primary" disabled={busy} onClick={() => void fill(it)}>
                Fill
              </button>
            </div>
          </li>
        ))}
      </ul>
      {status && <p className="error current-site-head">{status}</p>}
    </div>
  );
}
