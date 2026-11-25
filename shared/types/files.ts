/** A commission's files (milestone 10, ADR 0016): reference photos, previews, final files. */

export type FileKind = 'reference' | 'preview' | 'final';

export interface CommissionFile {
  id: number;
  kind: FileKind;
  /** What the uploader called it, for the download's name. */
  originalFilename: string | null;
  contentType: string;
  sizeBytes: number;
  /** Images only (reference photos, previews, and image finals). */
  width: number | null;
  height: number | null;
  createdAt: string;
  /** Shows an image in the page; null for files that aren't images. Expires in minutes. */
  url: string | null;
  /** Saves the file under its name. Expires in minutes: ask the list again for a fresh one. */
  downloadUrl: string;
  /** When the file is deleted (ADR 0016), once that's known. */
  deleteAfter: string | null;
}

export interface FilesMeta {
  /** False until file storage is configured; the page then hides uploads. */
  filesEnabled: boolean;
  /** Can the client add or remove reference photos now (before work starts)? */
  referencesOpen: boolean;
  referenceLimit: number;
  referenceMaxBytes: number;
  previewMaxBytes: number;
  finalMaxBytes: number;
}

export interface FilesResponse {
  data: CommissionFile[];
  meta: FilesMeta;
}
