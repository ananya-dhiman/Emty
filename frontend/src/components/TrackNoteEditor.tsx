import { useState } from 'react';

interface TrackNoteEditorProps {
  insightId: string;
  note: string | null;
  onSave: (insightId: string, note: string) => void;
  viewClass: string;
  editClass: string;
  emptyClass: string;
}

/**
 * Inline sticky-note editor for tracked threads.
 * Renders the note (or "+ Add note") as a chip; click to edit.
 * Enter/blur saves, Escape cancels. Defined at module level so parent
 * re-renders don't remount it mid-edit.
 */
export function TrackNoteEditor({ insightId, note, onSave, viewClass, editClass, emptyClass }: TrackNoteEditorProps) {
  const [editing, setEditing] = useState(false);
  // Seeded when edit mode opens (below) rather than synced from `note` via an
  // effect — a background refresh landing mid-edit would otherwise overwrite
  // whatever the user was typing.
  const [draft, setDraft] = useState(note || '');

  if (editing) {
    return (
      <input
        className={editClass}
        autoFocus
        value={draft}
        maxLength={200}
        placeholder="Add a note…"
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (draft.trim() !== (note || '')) onSave(insightId, draft);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') { setDraft(note || ''); setEditing(false); }
        }}
      />
    );
  }

  return (
    <button
      className={`${viewClass} ${note ? '' : emptyClass}`}
      onClick={(e) => { e.stopPropagation(); setDraft(note || ''); setEditing(true); }}
      title={note ? 'Edit note' : 'Add a note'}
    >
      {note || '+ Add note'}
    </button>
  );
}
