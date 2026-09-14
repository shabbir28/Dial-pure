import { Pencil, Trash2 } from 'lucide-react';

export default function RowActions({ onEdit, onDelete, deleteTitle = 'Archive' }) {
  return (
    <div className="row-actions">
      {onEdit ? (
        <button type="button" className="icon-btn" title="Edit" onClick={onEdit}>
          <Pencil size={14} />
        </button>
      ) : null}
      {onDelete ? (
        <button type="button" className="icon-btn icon-btn--danger" title={deleteTitle} onClick={onDelete}>
          <Trash2 size={14} />
        </button>
      ) : null}
    </div>
  );
}
