import { useState, useEffect } from 'preact/hooks';
import { validateDocument } from './schemas';
import type { ValidationError } from './schemas';

export function useDocumentValidation(doc: any | null): ValidationError[] {
  const [errors, setErrors] = useState<ValidationError[]>([]);

  useEffect(() => {
    if (!doc) {
      setErrors([]);
      return;
    }
    setErrors(validateDocument(doc));
  }, [doc]);

  return errors;
}
