import type { DocumentHistory } from './useDocumentHistory';

function formatTime(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function HistorySlider<T>({ history, dismissable = true }: { history: DocumentHistory<T>; dismissable?: boolean }) {
  if (!history.active) return null;

  return (
    <div className="flex items-center gap-2 px-2 py-1 bg-muted/50 border-b text-xs shrink-0">
      <span className="text-muted-foreground whitespace-nowrap">
        {history.version + 1} / {history.changeCount}
      </span>
      {history.changeCount > 1 && (
        <input
          type="range"
          className="flex-1 h-1 accent-primary"
          min={0}
          max={history.changeCount - 1}
          value={history.version}
          onInput={(e: any) => history.onSliderChange(parseInt(e.target.value))}
        />
      )}
      {history.time ? (
        <span className="text-muted-foreground whitespace-nowrap">{formatTime(history.time)}</span>
      ) : null}
      {history.editable ? (
        <span className="text-[0.7rem] px-1.5 py-0.5 rounded bg-green-100 text-green-800 font-medium">Editing</span>
      ) : (
        <>
          <span className="text-[0.7rem] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-medium">View only</span>
          <button
            className="text-[0.7rem] px-1.5 py-0.5 rounded border border-primary text-primary hover:bg-primary hover:text-primary-foreground"
            onClick={history.jumpToLatest}
          >
            Jump to latest
          </button>
        </>
      )}
      {dismissable && (
        <button
          className="text-muted-foreground hover:text-foreground ml-auto"
          onClick={history.toggleHistory}
          title="Close history"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
        </button>
      )}
    </div>
  );
}
