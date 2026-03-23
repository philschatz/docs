export type DocType = 'Calendar' | 'TaskList' | 'DataGrid' | 'unknown';

export function viewPathForType(type: DocType, documentId: string): string {
  if (type === 'Calendar') return `#/calendars/${documentId}`;
  if (type === 'TaskList') return `#/tasks/${documentId}`;
  if (type === 'DataGrid') return `#/datagrids/${documentId}`;
  return `#/source/${documentId}`;
}

export function iconForType(type: DocType): string {
  if (type === 'Calendar') return 'date_range';
  if (type === 'TaskList') return 'checklist';
  if (type === 'DataGrid') return 'grid_on';
  return 'help';
}
