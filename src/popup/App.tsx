import { useCallback, useEffect, useState } from 'react';
import { rpc, setReauthHandler } from '../messaging/rpc';
import type { StateInfo } from '../messaging/protocol';
import { errorMessage } from './util';
import { ConfigForm } from './components/ConfigForm';
import { ConnectForm } from './components/ConnectForm';
import { UnlockForm } from './components/UnlockForm';
import { VaultView } from './components/VaultView';

export function App() {
  const [state, setState] = useState<StateInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reconfigure, setReconfigure] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setState(await rpc('getState'));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // When any RPC reports the session expired, re-fetch state so the router lands
  // on the re-auth screen rather than leaving a dead error in place.
  useEffect(() => {
    setReauthHandler(() => void refresh());
    return () => setReauthHandler(null);
  }, [refresh]);

  const onState = (s: StateInfo) => {
    setReconfigure(false);
    setState(s);
  };

  if (error) {
    return (
      <div className="screen">
        <p className="error">{error}</p>
        <button onClick={() => void refresh()}>Retry</button>
      </div>
    );
  }
  if (!state) {
    return (
      <div className="screen">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  if (reconfigure || state.phase === 'needs-config') {
    return (
      <ConfigForm
        state={state}
        onDone={onState}
        onCancel={reconfigure ? () => setReconfigure(false) : undefined}
      />
    );
  }

  switch (state.phase) {
    case 'needs-connect':
      return <ConnectForm state={state} onDone={onState} onReconfigure={() => setReconfigure(true)} />;
    case 'needs-reauth':
      return (
        <ConnectForm
          state={state}
          onDone={onState}
          onReconfigure={() => setReconfigure(true)}
          expired
        />
      );
    case 'locked':
      return <UnlockForm state={state} onDone={onState} />;
    case 'unlocked':
      return <VaultView state={state} onState={onState} />;
  }
}
