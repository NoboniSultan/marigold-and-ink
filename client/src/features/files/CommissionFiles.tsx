/**
 * A commission's files on the site (milestone 10, ADR 0016): the client's reference
 * photos, the artist's watermarked previews, and the final files. The links in each file
 * expire in minutes; useCommissionFiles keeps them fresh.
 */
import { useRef, useState, type ChangeEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { CommissionFile, FilesMeta } from '@shared/types/files.ts';
import { ApiError, formMessage } from '../../api/client.ts';
import { filesApi } from '../../api/endpoints.ts';
import { queryKeys, useCommissionFiles } from '../../api/queries.ts';
import buttonStyles from '../../components/Button.module.css';
import styles from './files.module.css';
import sectionStyles from '../../pages/SimplePage.module.css';

/** Image types the reference upload asks for. iPhones turn HEIC photos into JPEG for it. */
export const REFERENCE_ACCEPT = 'image/jpeg,image/png,image/webp';

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Uploads the chosen files one at a time, then refreshes the list. Files over the size
 * limit are refused here, before uploading, with the same message the server would give.
 */
export function useUploader(
  commissionId: number,
  send: (commissionId: number, file: File) => Promise<unknown>,
  maxBytes: number,
) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  async function uploadAll(files: File[]) {
    setErrors([]);
    const problems: string[] = [];
    for (const file of files) {
      if (file.size > maxBytes) {
        problems.push(`${file.name}: too large (the limit is ${formatBytes(maxBytes)})`);
        continue;
      }
      setBusy(file.name);
      try {
        await send(commissionId, file);
      } catch (err) {
        problems.push(`${file.name}: ${formMessage(err)}`);
        // At the photo limit, the rest would be refused too.
        if (err instanceof ApiError && err.code === 'REFERENCE_LIMIT') break;
      }
    }
    setBusy(null);
    setErrors(problems);
    await queryClient.invalidateQueries({ queryKey: queryKeys.files(commissionId) });
  }

  return { busy, errors, uploadAll };
}

/** A "choose files" button backed by a hidden file input. */
export function FilePicker({
  label,
  accept,
  multiple = false,
  disabled,
  onFiles,
}: {
  label: string;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        hidden
        accept={accept}
        multiple={multiple}
        aria-label={label}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = ''; // choosing the same file again still fires
          if (files.length > 0) onFiles(files);
        }}
      />
      <button
        type="button"
        className={`${buttonStyles.button} ${buttonStyles.secondary}`}
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        {label}
      </button>
    </>
  );
}

function UploadStatus({ busy, errors }: { busy: string | null; errors: string[] }) {
  return (
    <>
      {busy && (
        <p className={styles.hint} role="status">
          Uploading {busy}…
        </p>
      )}
      {errors.length > 0 && (
        <ul className={styles.error} role="alert">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Reference photos: thumbnails, and (while allowed) adding and removing them. */
export function ReferencePhotos({
  commissionId,
  files,
  meta,
  editable,
}: {
  commissionId: number;
  files: CommissionFile[];
  meta: FilesMeta;
  editable: boolean;
}) {
  const queryClient = useQueryClient();
  const { busy, errors, uploadAll } = useUploader(
    commissionId,
    filesApi.uploadReference,
    meta.referenceMaxBytes,
  );
  const [removing, setRemoving] = useState<number | null>(null);
  const [removeError, setRemoveError] = useState<unknown>(null);
  const photos = files.filter((f) => f.kind === 'reference');
  const room = meta.referenceLimit - photos.length;

  async function remove(file: CommissionFile) {
    setRemoving(file.id);
    setRemoveError(null);
    try {
      await filesApi.remove(commissionId, file.id);
      await queryClient.invalidateQueries({ queryKey: queryKeys.files(commissionId) });
    } catch (err) {
      setRemoveError(err);
    } finally {
      setRemoving(null);
    }
  }

  return (
    <>
      {photos.length === 0 ? (
        <p className={styles.hint}>No reference photos yet.</p>
      ) : (
        <ul className={styles.grid} aria-label="Reference photos">
          {photos.map((file) => (
            <li key={file.id} className={styles.tile}>
              {file.url && <img src={file.url} alt={file.originalFilename ?? 'Reference photo'} />}
              <span className={styles.name}>{file.originalFilename}</span>
              {editable && (
                <button
                  type="button"
                  className={styles.linkButton}
                  disabled={removing === file.id}
                  onClick={() => remove(file)}
                >
                  {removing === file.id ? 'Removing…' : 'Remove'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {removeError ? (
        <p className={styles.error} role="alert">
          {formMessage(removeError)}
        </p>
      ) : null}
      {editable && (
        <div className={styles.picker}>
          <FilePicker
            label="Add reference photos"
            accept={REFERENCE_ACCEPT}
            multiple
            disabled={busy !== null || room <= 0}
            onFiles={(chosen) => uploadAll(chosen.slice(0, Math.max(room, 1)))}
          />
          <p className={styles.hint}>
            {photos.length} of {meta.referenceLimit}. JPEG, PNG, or WebP, up to{' '}
            {formatBytes(meta.referenceMaxBytes)} each. Location and camera details are removed when
            a photo is saved.
          </p>
          <UploadStatus busy={busy} errors={errors} />
        </div>
      )}
    </>
  );
}

/** Watermarked work-in-progress images, shown whole. */
export function PreviewGallery({ files }: { files: CommissionFile[] }) {
  const previews = files.filter((f) => f.kind === 'preview');
  if (previews.length === 0) return <p className={styles.hint}>No previews yet.</p>;
  return (
    <ul className={styles.previews} aria-label="Previews">
      {previews.map((file) => (
        <li key={file.id} className={styles.tile}>
          {file.url && (
            <a href={file.url} target="_blank" rel="noopener noreferrer">
              <img src={file.url} alt={`Preview: ${file.originalFilename ?? 'work in progress'}`} />
            </a>
          )}
          <span className={styles.hint}>Added {formatDay(file.createdAt)}</span>
        </li>
      ))}
    </ul>
  );
}

/** The final files, as download links, with how long they stay available. */
export function FinalDownloads({ files }: { files: CommissionFile[] }) {
  const finals = files.filter((f) => f.kind === 'final');
  if (finals.length === 0) return null;
  return (
    <ul className={styles.downloads} aria-label="Final files">
      {finals.map((file) => (
        <li key={file.id}>
          <a
            href={file.downloadUrl}
            className={`${buttonStyles.button} ${buttonStyles.primary}`}
            download={file.originalFilename ?? undefined}
          >
            Download {file.originalFilename ?? 'your artwork'} ({formatBytes(file.sizeBytes)})
          </a>
          {file.deleteAfter && (
            <p className={styles.hint}>Available until {formatDay(file.deleteAfter)}.</p>
          )}
        </li>
      ))}
    </ul>
  );
}

/** On the client's commission page: their photos, the previews, and the final files. */
export function ClientFiles({ commissionId }: { commissionId: number }) {
  const files = useCommissionFiles(commissionId);
  if (!files.data?.meta.filesEnabled) return null;
  const { data: list, meta } = files.data;
  const finals = list.filter((f) => f.kind === 'final');
  return (
    <>
      {finals.length > 0 && (
        <section className={sectionStyles.section} aria-labelledby="artwork-heading">
          <h2 id="artwork-heading">Your artwork</h2>
          <FinalDownloads files={list} />
        </section>
      )}
      <section className={sectionStyles.section} aria-labelledby="previews-heading">
        <h2 id="previews-heading">Previews</h2>
        <PreviewGallery files={list} />
      </section>
      <section className={sectionStyles.section} aria-labelledby="references-heading">
        <h2 id="references-heading">Reference photos</h2>
        <ReferencePhotos
          commissionId={commissionId}
          files={list}
          meta={meta}
          editable={meta.referencesOpen}
        />
        {!meta.referencesOpen && (
          <p className={styles.hint}>Reference photos can be changed until work starts.</p>
        )}
      </section>
    </>
  );
}

/** Right after a request is sent: the optional reference photos for it. */
export function ReferencesForNewRequest({ commissionId }: { commissionId: number }) {
  const files = useCommissionFiles(commissionId);
  if (!files.data?.meta.filesEnabled) return null;
  return (
    <section aria-labelledby="new-references-heading">
      <h3 id="new-references-heading">Add reference photos (optional)</h3>
      <ReferencePhotos
        commissionId={commissionId}
        files={files.data.data}
        meta={files.data.meta}
        editable={files.data.meta.referencesOpen}
      />
    </section>
  );
}
