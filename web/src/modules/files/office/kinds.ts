// The Office formats the editor opens, by file name. Kept apart from the editor so that the page can ask without loading it.
export type OfficeKind = 'docx' | 'xlsx' | 'pptx';

const KIND_BY_EXTENSION: Record<string, OfficeKind> = { docx: 'docx', xlsx: 'xlsx', pptx: 'pptx' };

/** The kind of Office document a file name says, or `undefined` for any other file. */
export function officeKindOf(name: string): OfficeKind | undefined {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? undefined : KIND_BY_EXTENSION[name.slice(dot + 1).toLowerCase()];
}
