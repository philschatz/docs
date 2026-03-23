import { useState, useCallback } from 'preact/hooks';
import { getContactName, setContactName } from '../contact-names';

export function EditableName({ agentId, suffix }: { agentId: string; suffix?: any }) {
  const saved = getContactName(agentId);
  const [draft, setDraft] = useState(saved || '');
  const [dirty, setDirty] = useState(false);

  const save = useCallback(() => {
    if (!dirty) return;
    setContactName(agentId, draft);
    setDirty(false);
  }, [agentId, draft, dirty]);

  return (
    <span className="flex items-center flex-1 gap-1">
      <input
        className="text-sm flex-1 bg-transparent outline-none px-0 min-w-0"
        value={draft}
        onInput={(e: any) => { setDraft(e.currentTarget.value); setDirty(true); }}
        onBlur={save}
        onKeyDown={(e: any) => {
          if (e.key === 'Enter') { save(); e.currentTarget.blur(); }
        }}
        placeholder={agentId.slice(0, 12) + '…'}
        title={agentId}
      />
      {suffix}
    </span>
  );
}
