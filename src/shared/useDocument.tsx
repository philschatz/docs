import { useState, useEffect } from 'preact/hooks';
import { type ComponentChildren } from 'preact';
import { openDoc } from '../client/worker-api';
import { Progress } from '../client/components/ui/progress';

export type DocStatus = 'loading' | 'ready' | 'error';

export function useDocument(docId: string | undefined) {
  const [status, setStatus] = useState<DocStatus>('loading');
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('Connecting\u2026');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!docId) {
      setStatus('error');
      setError('No document ID');
      return;
    }
    setStatus('loading');
    setProgress(0);
    setMessage('Connecting\u2026');
    setError(null);

    let cancelled = false;
    openDoc(docId, (pct, msg) => {
      if (!cancelled) { setProgress(pct); setMessage(msg); }
    })
      .then(() => { if (!cancelled) { setProgress(100); setMessage('Ready'); setStatus('ready'); } })
      .catch((err) => { if (!cancelled) { setStatus('error'); setError(err.message); } });

    return () => { cancelled = true; };
  }, [docId]);

  return { status, progress, message, error };
}

/**
 * Wrapper component that shows a progress bar while a document loads,
 * an error message on failure, and renders children once ready.
 */
export function DocLoader({ docId, children }: { docId: string | undefined; children: ComponentChildren }) {
  const { status, progress, message, error } = useDocument(docId);

  if (status === 'loading') return (
    <div className="p-6 max-w-sm mx-auto mt-12">
      <Progress value={progress} />
      <p className="text-sm text-muted-foreground mt-2 text-center">{message}</p>
    </div>
  );
  if (status === 'error') return (
    <p className="text-sm text-destructive p-4">{error}</p>
  );

  return <>{children}</>;
}
