import { useState } from 'react';
import { rpc } from '../../messaging/rpc';
import type { ItemDetail } from '../../messaging/protocol';
import type { Content, Field, FieldType, ItemType } from '../../items/types';
import { ITEM_TYPES, TYPE_FIELDS } from '../itemSchema';
import { errorMessage } from '../util';
import { Generator } from './Generator';
import { Icon } from './Icon';

const FIELD_TYPES: FieldType[] = ['text', 'hidden', 'totp', 'url'];

export function ItemEditor({
  initial,
  onSaved,
  onCancel,
}: {
  initial?: ItemDetail;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const initialData = (initial?.content.data ?? {}) as Record<string, unknown>;
  const [type, setType] = useState<ItemType>(initial?.type ?? 'login');
  const [title, setTitle] = useState((initialData.title as string) ?? '');
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const f of TYPE_FIELDS[initial?.type ?? 'login']) {
      v[f.key] = (initialData[f.key] as string) ?? '';
    }
    return v;
  });
  const [urlsText, setUrlsText] = useState(((initialData.urls as string[]) ?? []).join('\n'));
  const [customFields, setCustomFields] = useState<Field[]>(
    (initialData.custom_fields as Field[]) ?? [],
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // When set, the inline generator is open for this field key.
  const [genFor, setGenFor] = useState<string | null>(null);

  const fields = TYPE_FIELDS[type];

  const onTypeChange = (next: ItemType) => {
    setType(next);
    setValues((prev) => {
      const v: Record<string, string> = {};
      for (const f of TYPE_FIELDS[next]) v[f.key] = prev[f.key] ?? '';
      return v;
    });
  };

  const setCustom = (i: number, patch: Partial<Field>) => {
    setCustomFields((cfs) => cfs.map((cf, idx) => (idx === i ? { ...cf, ...patch } : cf)));
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const data: Record<string, unknown> = { title };
      for (const f of fields) {
        const v = values[f.key];
        if (v) data[f.key] = v;
      }
      if (type === 'login') {
        const urls = urlsText
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean);
        if (urls.length) data.urls = urls;
      }
      const cleaned = customFields.filter((cf) => cf.label || cf.value);
      if (cleaned.length) data.custom_fields = cleaned;

      const content = { kind: type, data } as unknown as Content;
      if (initial) {
        await rpc('updateItem', { id: initial.id, content });
      } else {
        await rpc('createItem', { content });
      }
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (genFor) {
    const key = genFor;
    return (
      <Generator
        onUse={(v) => {
          setValues((prev) => ({ ...prev, [key]: v }));
          setGenFor(null);
        }}
        onClose={() => setGenFor(null)}
      />
    );
  }

  return (
    <div>
      <div className="topbar">
        <button className="iconbtn" type="button" onClick={onCancel}>
          <Icon name="back" size={14} /> Cancel
        </button>
        <span className="title">{initial ? 'Edit item' : 'New item'}</span>
        <span />
      </div>
      <form className="screen" onSubmit={save}>
        {!initial && (
          <>
            <label htmlFor="type">Type</label>
            <select id="type" value={type} onChange={(e) => onTypeChange(e.target.value as ItemType)}>
              {ITEM_TYPES.map((t) => (
                <option key={t.type} value={t.type}>
                  {t.label}
                </option>
              ))}
            </select>
          </>
        )}

        <label htmlFor="title">Title</label>
        <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required />

        {fields.map((f) => (
          <div key={f.key}>
            <label htmlFor={f.key}>{f.editLabel ?? f.label}</label>
            {f.multiline ? (
              <textarea
                id={f.key}
                value={values[f.key] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              />
            ) : (
              <input
                id={f.key}
                type={f.secret ? 'password' : 'text'}
                value={values[f.key] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              />
            )}
            {f.key === 'password' && (
              <button type="button" className="link" onClick={() => setGenFor(f.key)}>
                <Icon name="refresh" size={12} /> Generate
              </button>
            )}
          </div>
        ))}

        {type === 'login' && (
          <>
            <label htmlFor="urls">URLs (one per line)</label>
            <textarea id="urls" value={urlsText} onChange={(e) => setUrlsText(e.target.value)} />
          </>
        )}

        <h2>Custom fields</h2>
        {customFields.map((cf, i) => (
          <div key={i} className="custom-field">
            <div className="row">
              <select value={cf.type} onChange={(e) => setCustom(i, { type: e.target.value as FieldType })}>
                {FIELD_TYPES.map((ft) => (
                  <option key={ft} value={ft}>
                    {ft}
                  </option>
                ))}
              </select>
              <input
                placeholder="Label"
                value={cf.label}
                onChange={(e) => setCustom(i, { label: e.target.value })}
              />
              <button type="button" className="link danger" onClick={() => setCustomFields((cfs) => cfs.filter((_, idx) => idx !== i))}>
                <Icon name="close" size={12} />
              </button>
            </div>
            <input
              placeholder="Value"
              type={cf.type === 'hidden' ? 'password' : 'text'}
              value={cf.value}
              onChange={(e) => setCustom(i, { value: e.target.value })}
            />
          </div>
        ))}
        <button
          type="button"
          className="link"
          onClick={() => setCustomFields((cfs) => [...cfs, { type: 'text', label: '', value: '' }])}
        >
          <Icon name="add" size={12} /> Add custom field
        </button>

        {error && <p className="error">{error}</p>}

        <div className="actions">
          <button type="submit" className="primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
