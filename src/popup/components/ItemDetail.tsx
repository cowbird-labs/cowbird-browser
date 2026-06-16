import { useCallback, useEffect, useState } from 'react';
import { rpc } from '../../messaging/rpc';
import type { ItemDetail as ItemDetailData } from '../../messaging/protocol';
import type { Field } from '../../items/types';
import { TYPE_FIELDS, typeLabel } from '../itemSchema';
import { copyText, errorMessage } from '../util';
import { getActiveTab, fillActiveTab } from '../autofill';
import { totpNow, groupDigits } from '../totp';
import { ItemEditor } from './ItemEditor';
import { SharePanel } from './SharePanel';

function FieldRow({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [revealed, setRevealed] = useState(false);
  if (!value) return null;
  const shown = secret && !revealed ? '••••••••' : value;
  return (
    <div className="field">
      <div className="field-label">{label}</div>
      <div className="field-value">
        <span className="val">{shown}</span>
        {secret && (
          <button className="iconbtn" title={revealed ? 'Hide' : 'Reveal'} onClick={() => setRevealed((r) => !r)}>
            {revealed ? '🙈' : '👁'}
          </button>
        )}
        <button className="iconbtn" title="Copy" onClick={() => void copyText(value)}>
          ⧉
        </button>
      </div>
    </div>
  );
}

// Renders the live one-time code derived from a stored TOTP secret rather than
// the secret itself, refreshing every second with a countdown to the next
// rotation. Copy yields the current digits (no spacing).
function TotpRow({ label, secret }: { label: string; secret: string }) {
  const [code, setCode] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (!secret) return;
    let active = true;
    const tick = async () => {
      try {
        const { code, remaining } = await totpNow(secret);
        if (!active) return;
        setCode(code);
        setRemaining(remaining);
        setInvalid(false);
      } catch {
        if (!active) return;
        setInvalid(true);
        setCode(null);
      }
    };
    void tick();
    const id = setInterval(() => void tick(), 1000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [secret]);

  if (!secret) return null;
  return (
    <div className="field">
      <div className="field-label">{label}</div>
      <div className="field-value">
        {invalid ? (
          <span className="val muted">Invalid TOTP secret</span>
        ) : (
          <>
            <span className="val">{code ? groupDigits(code) : '…'}</span>
            {code && <span className="totp-countdown">{remaining}s</span>}
            <button className="iconbtn" title="Copy code" disabled={!code} onClick={() => code && void copyText(code)}>
              ⧉
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function ItemDetail({
  id,
  shared,
  onBack,
  afterChange,
}: {
  id: string;
  shared: boolean;
  onBack: () => void;
  afterChange: () => void;
}) {
  const [detail, setDetail] = useState<ItemDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setDetail(await rpc('getItem', { id, shared }));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id, shared]);

  useEffect(() => {
    void load();
  }, [load]);

  if (editing && detail) {
    return (
      <ItemEditor
        initial={detail}
        onCancel={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          void load();
          afterChange();
        }}
      />
    );
  }

  const fillPage = async () => {
    setError(null);
    const d = (detail?.content.data ?? {}) as { username?: string; password?: string };
    const tab = await getActiveTab();
    if (!tab) {
      setError('No active page to fill.');
      return;
    }
    const ok = await fillActiveTab(tab.id, d.username ?? '', d.password ?? '');
    if (ok) {
      window.close();
    } else {
      setError('No login field found on this page. Reload the page and try again.');
    }
  };

  const del = async () => {
    if (!confirm('Delete this item? This cannot be undone.')) return;
    try {
      await rpc('deleteItem', { id });
      afterChange();
      onBack();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const data = (detail?.content.data ?? {}) as Record<string, unknown>;
  const fields = detail ? TYPE_FIELDS[detail.type] : [];
  const urls = (data.urls as string[] | undefined) ?? [];
  const customFields = (data.custom_fields as Field[] | undefined) ?? [];

  return (
    <div>
      <div className="topbar">
        <button className="iconbtn" onClick={onBack}>
          ‹ Back
        </button>
        <span className="title">{shared ? 'Shared item' : typeLabel(detail?.type ?? 'login')}</span>
        <span />
      </div>
      <div className="screen">
        {error && <p className="error">{error}</p>}
        {!detail ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            <h1>{(data.title as string) || '(untitled)'}</h1>
            {fields.map((f) =>
              f.totp ? (
                <TotpRow key={f.key} label={f.label} secret={(data[f.key] as string) ?? ''} />
              ) : (
                <FieldRow key={f.key} label={f.label} value={(data[f.key] as string) ?? ''} secret={f.secret} />
              ),
            )}
            {urls.map((u, i) => (
              <FieldRow key={`url-${i}`} label="URL" value={u} />
            ))}
            {customFields.map((cf, i) =>
              cf.type === 'totp' ? (
                <TotpRow key={`cf-${i}`} label={cf.label} secret={cf.value} />
              ) : (
                <FieldRow key={`cf-${i}`} label={cf.label} value={cf.value} secret={cf.type === 'hidden'} />
              ),
            )}

            {detail.type === 'login' && (
              <div className="actions">
                <button className="primary" onClick={() => void fillPage()}>
                  Fill on this page
                </button>
              </div>
            )}

            {!shared && (
              <SharePanel itemId={id} recipients={detail.recipients ?? []} afterChange={() => void load()} />
            )}

            {!shared && (
              <div className="actions">
                <button className="primary" onClick={() => setEditing(true)}>
                  Edit
                </button>
                <button className="danger" onClick={() => void del()}>
                  Delete
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
