import type { Strength } from '../../generate';

// band picks the colour class from the coarse label so the bar's colour and the
// text agree. Kept in sync with strengthFromBits' label thresholds.
function band(label: string): string {
  switch (label) {
    case 'Strong':
      return 'strong';
    case 'Good':
      return 'good';
    case 'Fair':
      return 'fair';
    default:
      return 'weak';
  }
}

/**
 * StrengthMeter renders an advisory password-strength bar with its label and the
 * underlying bit estimate. It draws nothing for empty input (no label), so it can
 * sit unconditionally beneath a password field without showing for a blank value.
 */
export function StrengthMeter({ strength }: { strength: Strength }) {
  if (!strength.label) return null;
  return (
    <div className="strength" aria-hidden>
      <div className="strength-track">
        <div
          className={`strength-fill ${band(strength.label)}`}
          style={{ width: `${Math.round(strength.score * 100)}%` }}
        />
      </div>
      <span className="strength-text muted">
        {strength.label} · {Math.round(strength.bits)} bits
      </span>
    </div>
  );
}
