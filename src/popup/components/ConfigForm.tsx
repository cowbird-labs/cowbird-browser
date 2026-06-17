import { useEffect, useRef, useState } from 'react';
import { rpc } from '../../messaging/rpc';
import type { AuthMethodInfo, StateInfo } from '../../messaging/protocol';
import { addressMissingPort, addressSchemeIssue, errorMessage } from '../util';
import type { AddressSchemeIssue } from '../util';
import { Icon } from './Icon';

export function ConfigForm({
  state,
  onDone,
  onCancel,
}: {
  state: StateInfo;
  onDone: (s: StateInfo) => void;
  onCancel?: () => void;
}) {
  const [address, setAddress] = useState(state.config?.address ?? '');
  const [mount, setMount] = useState(state.config?.mount ?? 'cowbird');
  const [namespace, setNamespace] = useState(state.config?.namespace ?? '');
  const [authMethodId, setAuthMethodId] = useState(state.config?.authMethodId ?? 'userpass');
  const [authMethods, setAuthMethods] = useState<AuthMethodInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [portWarning, setPortWarning] = useState(false);
  const [schemeIssue, setSchemeIssue] = useState<AddressSchemeIssue>(null);
  const addressRef = useRef<HTMLInputElement>(null);

  // Re-check the address quirks (no port / no scheme / http) when it loses focus.
  const checkAddress = () => {
    setPortWarning(addressMissingPort(address));
    setSchemeIssue(addressSchemeIssue(address));
  };
  const clearAddressNotices = () => {
    setPortWarning(false);
    setSchemeIssue(null);
  };

  useEffect(() => {
    rpc('getAuthMethods')
      .then(setAuthMethods)
      .catch((e) => setError(errorMessage(e)));
  }, []);

  // Focus the address field on open — it's the first thing to fill in. Deferred a
  // frame: focusing during the mount commit gets overridden when the extension
  // popup assigns its own focus on first paint.
  useEffect(() => {
    const id = requestAnimationFrame(() => addressRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const next = await rpc('saveConfig', {
        address: address.trim(),
        mount: mount.trim(),
        namespace: namespace.trim() || undefined,
        authMethodId,
      });
      onDone(next);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <form className="screen" onSubmit={save}>
      <h1>Connect to Vault</h1>
      <p className="muted">Cowbird stores everything in your own HashiCorp Vault.</p>

      <label htmlFor="address">Vault address</label>
      <input
        id="address"
        ref={addressRef}
        placeholder="https://vault.example.com:8200"
        value={address}
        onChange={(e) => {
          setAddress(e.target.value);
          clearAddressNotices(); // re-checked on blur
        }}
        onBlur={checkAddress}
        required
      />
      {schemeIssue === 'insecure' && (
        <p className="notice">
          <Icon name="alert" size={14} />
          Uses http — credentials would be sent unencrypted. Prefer https.
        </p>
      )}
      {schemeIssue === 'no-scheme' && (
        <p className="notice">
          <Icon name="alert" size={14} />
          No protocol — https will be assumed.
        </p>
      )}
      {portWarning && (
        <p className="notice">
          <Icon name="alert" size={14} />
          No port in the address — Vault usually listens on :8200.
        </p>
      )}

      <label htmlFor="mount">KV v2 mount</label>
      <input id="mount" value={mount} onChange={(e) => setMount(e.target.value)} required />

      <label htmlFor="namespace">Namespace (optional)</label>
      <input id="namespace" value={namespace} onChange={(e) => setNamespace(e.target.value)} />

      <label htmlFor="auth">Authentication method</label>
      <select id="auth" value={authMethodId} onChange={(e) => setAuthMethodId(e.target.value)}>
        {authMethods.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>

      {error && <p className="error">{error}</p>}

      <div className="actions">
        <button type="submit" className="primary">
          Continue
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
