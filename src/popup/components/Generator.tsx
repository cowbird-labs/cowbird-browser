import { useCallback, useEffect, useRef, useState } from 'react';
import {
  password as genPassword,
  passphrase as genPassphrase,
  passphraseEntropy,
  passwordStrength,
  strengthFromBits,
} from '../../generate';
import {
  loadSettings,
  saveSettings,
  DEFAULT_SETTINGS,
  type GeneratorSettings,
  type GenMode,
} from '../generatorSettings';
import { Icon } from './Icon';
import { StrengthMeter } from './StrengthMeter';

/**
 * Generator is the password/passphrase generator surface. When `onUse` is
 * provided it is used inline from the item editor and shows a "Use" button that
 * fills the originating field; without it (standalone, from the main view) it
 * only offers Copy. Cancelling leaves any originating field unchanged.
 */
export function Generator({
  onUse,
  onClose,
}: {
  onUse?: (value: string) => void;
  onClose: () => void;
}) {
  const [settings, setSettings] = useState<GeneratorSettings>(DEFAULT_SETTINGS);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const loaded = useRef(false);

  const regenerate = useCallback((s: GeneratorSettings) => {
    try {
      setValue(s.mode === 'password' ? genPassword(s.password) : genPassphrase(s.passphrase));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setValue('');
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const s = await loadSettings();
      loaded.current = true;
      setSettings(s);
      regenerate(s);
    })();
  }, [regenerate]);

  // update applies new settings, regenerates, and persists (once initial load
  // has happened, so we never overwrite stored settings with the defaults).
  const update = (next: GeneratorSettings) => {
    setSettings(next);
    regenerate(next);
    if (loaded.current) void saveSettings(next);
  };

  const p = settings.password;
  const pp = settings.passphrase;
  const setP = (patch: Partial<typeof p>) => update({ ...settings, password: { ...p, ...patch } });
  const setPP = (patch: Partial<typeof pp>) => update({ ...settings, passphrase: { ...pp, ...patch } });
  const setMode = (mode: GenMode) => update({ ...settings, mode });

  // Match the desktop generator's readout: password mode scores the actual
  // generated value with the charset heuristic, while passphrase mode uses the
  // exact word-choice entropy.
  const strength =
    settings.mode === 'password'
      ? passwordStrength(value)
      : strengthFromBits(passphraseEntropy(pp));

  // Prevent disabling the last enabled character class.
  const classCount = [p.lower, p.upper, p.digits, p.symbols].filter(Boolean).length;
  const onlyClass = (on: boolean) => classCount === 1 && on;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard may be unavailable; ignore.
    }
  };

  return (
    <div>
      <div className="topbar">
        <button className="iconbtn" type="button" onClick={onClose}>
          <Icon name="back" size={14} /> {onUse ? 'Back' : 'Close'}
        </button>
        <span className="title">Generator</span>
        <span />
      </div>
      <div className="screen">
        <div className="gen-output">
          <code className="gen-value">{value || '—'}</code>
          <button
            className="iconbtn"
            type="button"
            title="Regenerate"
            onClick={() => regenerate(settings)}
          >
            <Icon name="refresh" />
          </button>
        </div>
        {error ? <p className="error">{error}</p> : <StrengthMeter strength={strength} />}

        <div className="row gen-modes">
          <button
            type="button"
            className={settings.mode === 'password' ? 'primary' : ''}
            onClick={() => setMode('password')}
          >
            Password
          </button>
          <button
            type="button"
            className={settings.mode === 'passphrase' ? 'primary' : ''}
            onClick={() => setMode('passphrase')}
          >
            Passphrase
          </button>
        </div>

        {settings.mode === 'password' ? (
          <>
            <label htmlFor="gen-len">Length: {p.length}</label>
            <input
              id="gen-len"
              type="range"
              min={4}
              max={64}
              value={p.length}
              onChange={(e) => setP({ length: Number(e.target.value) })}
            />
            <label className="check">
              <input
                type="checkbox"
                checked={p.lower}
                disabled={onlyClass(p.lower)}
                onChange={(e) => setP({ lower: e.target.checked })}
              />{' '}
              Lowercase (a–z)
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={p.upper}
                disabled={onlyClass(p.upper)}
                onChange={(e) => setP({ upper: e.target.checked })}
              />{' '}
              Uppercase (A–Z)
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={p.digits}
                disabled={onlyClass(p.digits)}
                onChange={(e) => setP({ digits: e.target.checked })}
              />{' '}
              Digits (0–9)
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={p.symbols}
                disabled={onlyClass(p.symbols)}
                onChange={(e) => setP({ symbols: e.target.checked })}
              />{' '}
              Symbols
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={p.excludeAmbiguous}
                onChange={(e) => setP({ excludeAmbiguous: e.target.checked })}
              />{' '}
              Exclude ambiguous (il1IoO0|)
            </label>
          </>
        ) : (
          <>
            <label htmlFor="gen-words">Words: {pp.words}</label>
            <input
              id="gen-words"
              type="range"
              min={3}
              max={12}
              value={pp.words}
              onChange={(e) => setPP({ words: Number(e.target.value) })}
            />
            <label htmlFor="gen-sep">Separator</label>
            <input
              id="gen-sep"
              value={pp.separator}
              maxLength={3}
              onChange={(e) => setPP({ separator: e.target.value })}
            />
            <label className="check">
              <input
                type="checkbox"
                checked={pp.capitalize}
                onChange={(e) => setPP({ capitalize: e.target.checked })}
              />{' '}
              Capitalize words
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={pp.includeNumber}
                onChange={(e) => setPP({ includeNumber: e.target.checked })}
              />{' '}
              Include a number
            </label>
          </>
        )}

        <div className="actions">
          {onUse && (
            <button type="button" className="primary" disabled={!value} onClick={() => onUse(value)}>
              Use
            </button>
          )}
          <button type="button" disabled={!value} onClick={() => void copy()}>
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>
    </div>
  );
}
