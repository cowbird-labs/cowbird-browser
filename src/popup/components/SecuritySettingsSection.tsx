import { useEffect, useState } from 'react';
import { rpc } from '../../messaging/rpc';
import {
  DEFAULT_SECURITY_SETTINGS,
  loadSecuritySettings,
  normalizeSecuritySettings,
} from '../../settings/security';

// Auto-lock and clipboard-clear preferences. Changes persist immediately via the
// worker (rpc setSecuritySettings), which also re-arms the inactivity timer.
// Numeric fields are edited as free text and normalized (clamped to >= 1) on blur.
export function SecuritySettingsSection() {
  const [autoLock, setAutoLock] = useState(DEFAULT_SECURITY_SETTINGS.autoLock);
  const [minutes, setMinutes] = useState(String(DEFAULT_SECURITY_SETTINGS.autoLockMinutes));
  const [clipboardClear, setClipboardClear] = useState(DEFAULT_SECURITY_SETTINGS.clipboardClear);
  const [seconds, setSeconds] = useState(String(DEFAULT_SECURITY_SETTINGS.clipboardClearSeconds));

  useEffect(() => {
    void loadSecuritySettings().then((s) => {
      setAutoLock(s.autoLock);
      setMinutes(String(s.autoLockMinutes));
      setClipboardClear(s.clipboardClear);
      setSeconds(String(s.clipboardClearSeconds));
    });
  }, []);

  const save = (next: {
    autoLock: boolean;
    minutes: string;
    clipboardClear: boolean;
    seconds: string;
  }) => {
    const norm = normalizeSecuritySettings({
      autoLock: next.autoLock,
      autoLockMinutes: parseInt(next.minutes, 10),
      clipboardClear: next.clipboardClear,
      clipboardClearSeconds: parseInt(next.seconds, 10),
    });
    // Reflect the clamped values back into the fields.
    setAutoLock(norm.autoLock);
    setMinutes(String(norm.autoLockMinutes));
    setClipboardClear(norm.clipboardClear);
    setSeconds(String(norm.clipboardClearSeconds));
    void rpc('setSecuritySettings', norm).catch(() => {});
  };

  return (
    <>
      <h2>Auto-lock</h2>
      <label className="toggle">
        <input
          type="checkbox"
          checked={autoLock}
          onChange={(e) => save({ autoLock: e.target.checked, minutes, clipboardClear, seconds })}
        />
        Lock the vault after a period of inactivity
      </label>
      <label htmlFor="al-min">Lock after (minutes)</label>
      <input
        id="al-min"
        type="number"
        min={1}
        value={minutes}
        disabled={!autoLock}
        onChange={(e) => setMinutes(e.target.value)}
        onBlur={() => save({ autoLock, minutes, clipboardClear, seconds })}
      />

      <h2>Clipboard</h2>
      <label className="toggle">
        <input
          type="checkbox"
          checked={clipboardClear}
          onChange={(e) =>
            save({ autoLock, minutes, clipboardClear: e.target.checked, seconds })
          }
        />
        Clear the clipboard after copying a value
      </label>
      <label htmlFor="cb-sec">Clear after (seconds)</label>
      <input
        id="cb-sec"
        type="number"
        min={1}
        value={seconds}
        disabled={!clipboardClear}
        onChange={(e) => setSeconds(e.target.value)}
        onBlur={() => save({ autoLock, minutes, clipboardClear, seconds })}
      />
    </>
  );
}
