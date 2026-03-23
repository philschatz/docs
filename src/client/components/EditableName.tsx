import { useState } from 'preact/hooks';
import { getContactName, setContactName } from '../contact-names';

export function EditableName({ agentId, suffix }: { agentId: string; suffix?: any }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const saved = getContactName(agentId);

  const startEdit = () => {
    setDraft(saved || '');
    setEditing(true);
  };

  const commit = () => {
    setContactName(agentId, draft);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        className="text-sm flex-1 border-b border-border bg-transparent outline-none px-0"
        value={draft}
        onInput={(e: any) => setDraft(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e: any) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setEditing(false);
        }}
        autoFocus
        placeholder={agentId.slice(0, 8) + '…'}
      />
    );
  }

  return (
    <span className="text-sm flex-1 truncate group" title={agentId}>
      {saved || `${agentId.slice(0, 8)}…`}
      {suffix}
      <button
        className="ml-1 opacity-0 group-hover:opacity-50 hover:!opacity-100 inline-flex align-middle"
        onClick={(e: any) => { e.stopPropagation(); startEdit(); }}
        title="Set friendly name"
      >
        <span className="material-symbols-outlined" style={{ fontSize: 12 }}>edit</span>
      </button>
    </span>
  );
}
