import { useEffect, useState } from 'react';
import { rpc } from '../../messaging/rpc';
import type { AuthMethodInfo, StateInfo } from '../../messaging/protocol';
import { errorMessage } from '../util';

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

  useEffect(() => {
    rpc('getAuthMethods')
      .then(setAuthMethods)
      .catch((e) => setError(errorMessage(e)));
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
        placeholder="https://vault.example.com:8200"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        required
      />

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
