import { useRef, useState, useCallback } from 'preact/hooks';
import { restoreDocToHeads } from '../client/worker-api';

export { toPlain, syncToTarget } from './sync-to-target';

const MAX_UNDO = 100;

export function useUndoRedo(docId: string) {
  const undoStackRef = useRef<string[][]>([]);
  const redoStackRef = useRef<string[][]>([]);
  const skipNextUpdateRef = useRef(false);
  const prevHeadsRef = useRef<string[] | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  /**
   * Call this from your subscribeQuery callback whenever new heads arrive.
   * Pushes the previous heads onto the undo stack (unless this update is from an undo/redo).
   */
  const onHeadsUpdate = useCallback((heads: string[]) => {
    const prev = prevHeadsRef.current;
    prevHeadsRef.current = heads;
    if (skipNextUpdateRef.current) {
      skipNextUpdateRef.current = false;
      return;
    }
    if (prev) {
      undoStackRef.current.push(prev);
      if (undoStackRef.current.length > MAX_UNDO) undoStackRef.current.shift();
      redoStackRef.current = [];
      setCanUndo(true);
      setCanRedo(false);
    }
  }, []);

  const undo = useCallback(() => {
    if (!undoStackRef.current.length || !prevHeadsRef.current) return;
    const target = undoStackRef.current.pop()!;
    redoStackRef.current.push(prevHeadsRef.current);
    skipNextUpdateRef.current = true;
    restoreDocToHeads(docId, target);
    setCanUndo(undoStackRef.current.length > 0);
    setCanRedo(true);
  }, [docId]);

  const redo = useCallback(() => {
    if (!redoStackRef.current.length || !prevHeadsRef.current) return;
    const target = redoStackRef.current.pop()!;
    undoStackRef.current.push(prevHeadsRef.current);
    skipNextUpdateRef.current = true;
    restoreDocToHeads(docId, target);
    setCanUndo(true);
    setCanRedo(redoStackRef.current.length > 0);
  }, [docId]);

  return { undo, redo, canUndo, canRedo, onHeadsUpdate };
}
