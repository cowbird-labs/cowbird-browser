import type { Label } from '../../messaging/protocol';
import { Icon } from './Icon';

/** LabelChips renders a row of small colored chips for a set of assigned label
 * IDs, resolving names/colors against the provided label set. Unknown IDs (a
 * label deleted out from under a stale view) are skipped. */
export function LabelChips({
  labelIds,
  labelById,
  onRemove,
}: {
  labelIds: string[];
  labelById: Map<string, Label>;
  onRemove?: (labelId: string) => void;
}) {
  const labels = labelIds.map((id) => labelById.get(id)).filter((l): l is Label => Boolean(l));
  if (labels.length === 0) return null;
  return (
    <div className="chips">
      {labels.map((l) => (
        <span key={l.id} className="chip">
          <span className="chip-dot" style={{ background: l.color || 'var(--accent)' }} />
          {l.name}
          {onRemove && (
            <button
              type="button"
              className="chip-x"
              title={`Remove ${l.name}`}
              onClick={() => onRemove(l.id)}
            >
              <Icon name="close" size={10} />
            </button>
          )}
        </span>
      ))}
    </div>
  );
}
