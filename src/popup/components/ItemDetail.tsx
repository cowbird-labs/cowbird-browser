import { useCallback, useEffect, useState } from 'react';
import { rpc } from '../../messaging/rpc';
import type { ItemDetail as ItemDetailData } from '../../messaging/protocol';
import type { Field, FieldType } from '../../items/types';
import { TYPE_FIELDS, typeLabel } from '../itemSchema';
import { copyText, errorMessage } from '../util';
import { getActiveTab, fillActiveTab } from '../autofill';
import { totpNow, groupDigits, TOTP_PERIOD } from '../totp';
import { Icon } from './Icon';
import { ItemEditor } from './ItemEditor';
import { SharePanel } from './SharePanel';

// useCopied gives a click handler that copies a value and briefly flips a
// `copied` flag for "Copied" feedback on the row.
function useCopied(): [boolean, (value: string) => void] {
  const [copied, setCopied] = useState(false);
  const copy = (value: string) => {
    if (!value) return;
    void copyText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return [copied, copy];
}

function FieldRow({
  icon,
  label,
  value,
  secret,
  mono,
}: {
  icon?: string;
  label: string;
  value: string;
  secret?: boolean;
  mono?: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const [copied, copy] = useCopied();
  if (!value) return null;
  const shown = secret && !revealed ? '••••••••••••' : value;
  return (
    <div className="field">
      <Icon name={icon} className="field-icon" />
      <button type="button" className="field-main" title="Copy" onClick={() => copy(value)}>
        <div className="field-label">{copied ? 'Copied' : label}</div>
        <div className={`val${mono ? ' mono' : ''}`}>{shown}</div>
      </button>
      {secret && (
        <button
          type="button"
          className="iconbtn"
          title={revealed ? 'Hide' : 'Reveal'}
          onClick={() => setRevealed((r) => !r)}
        >
          <Icon name={revealed ? 'eye-off' : 'eye'} size={16} />
        </button>
      )}
    </div>
  );
}

// Renders the live one-time code derived from a stored TOTP secret rather than
// the secret itself, refreshing every second with a depleting countdown ring.
// Copy yields the current digits (no spacing).
function TotpRow({ icon, label, secret }: { icon?: string; label: string; secret: string }) {
  const [code, setCode] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [invalid, setInvalid] = useState(false);
  const [copied, copy] = useCopied();

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
      <Icon name={icon ?? 'lock'} className="field-icon" />
      <button
        type="button"
        className="field-main"
        title="Copy code"
        disabled={!code}
        onClick={() => code && copy(code)}
      >
        <div className="field-label">{copied ? 'Copied' : label}</div>
        <div className="val mono">
          {invalid ? 'Invalid TOTP secret' : code ? groupDigits(code) : '…'}
        </div>
      </button>
      {!invalid && code && (
        <span
          className="totp-ring"
          style={{ ['--pct' as string]: `${(remaining / TOTP_PERIOD) * 100}%` }}
          title={`${remaining}s until refresh`}
        >
          <span>{remaining}</span>
        </span>
      )}
    </div>
  );
}

const CUSTOM_ICONS: Record<FieldType, string> = {
  text: 'info',
  hidden: 'lock',
  totp: 'lock',
  url: 'globe',
};

function normalizeHref(url: string): string {
  return url.includes('://') ? url : `https://${url}`;
}

function WebsitesGroup({ urls }: { urls: string[] }) {
  return (
    <div className="field">
      <Icon name="globe" className="field-icon" />
      <div className="field-main">
        <div className="field-label">{urls.length > 1 ? 'Websites' : 'Website'}</div>
        {urls.map((u, i) => (
          <a key={i} className="url-link" href={normalizeHref(u)} target="_blank" rel="noopener noreferrer">
            {u}
          </a>
        ))}
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
  const urls = (data.urls as string[] | undefined) ?? [];
  const customFields = ((data.custom_fields as Field[] | undefined) ?? []).filter((cf) => cf.value);
  // Only the fields that actually have a value get a row (and thus a card).
  const fields = (detail ? TYPE_FIELDS[detail.type] : []).filter((f) => (data[f.key] as string) ?? '');

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
            <div className="detail-head">
              <h1>{(data.title as string) || '(untitled)'}</h1>
              <div className="muted">{shared ? 'Shared with you' : typeLabel(detail.type)}</div>
            </div>

            {fields.length > 0 && (
              <div className="card">
                {fields.map((f) =>
                  f.totp ? (
                    <TotpRow key={f.key} icon={f.icon} label={f.label} secret={(data[f.key] as string) ?? ''} />
                  ) : (
                    <FieldRow
                      key={f.key}
                      icon={f.icon}
                      label={f.label}
                      value={(data[f.key] as string) ?? ''}
                      secret={f.secret}
                      mono={f.mono}
                    />
                  ),
                )}
              </div>
            )}

            {urls.length > 0 && (
              <div className="card">
                <WebsitesGroup urls={urls} />
              </div>
            )}

            {customFields.length > 0 && (
              <div className="card">
                {customFields.map((cf, i) =>
                  cf.type === 'totp' ? (
                    <TotpRow key={`cf-${i}`} icon="lock" label={cf.label} secret={cf.value} />
                  ) : (
                    <FieldRow
                      key={`cf-${i}`}
                      icon={CUSTOM_ICONS[cf.type]}
                      label={cf.label}
                      value={cf.value}
                      secret={cf.type === 'hidden'}
                      mono={cf.type === 'hidden'}
                    />
                  ),
                )}
              </div>
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
