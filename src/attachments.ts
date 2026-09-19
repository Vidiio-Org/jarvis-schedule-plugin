import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { StoredAttachment } from './types.js';
import { ValidationError } from './validation.js';

/** Per-file cap — the same 50 MiB the ADE Bridge enforces (`MAX_ATTACHMENT_BYTES`). */
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
/** The Bridge's base64 ceiling for one file (`MAX_ATTACHMENT_BASE64_LENGTH`). */
export const MAX_ATTACHMENT_BASE64_LENGTH = Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4 + 4;
/** Request-body cap of the upload route: one base64 file plus JSON wrapper slack (as in the Bridge). */
export const MAX_ATTACHMENT_BODY_BYTES = MAX_ATTACHMENT_BASE64_LENGTH + 4_096;
/** Total bytes kept per schedule (every dispatch re-uploads all of them). */
export const MAX_SCHEDULE_ATTACHMENT_BYTES = 200 * 1024 * 1024;
export const MAX_SCHEDULE_ATTACHMENTS = 20;

const MAX_NAME_LENGTH = 200;
const DEFAULT_MIME = 'application/octet-stream';
const MIME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

export class PayloadTooLargeError extends Error {}

/**
 * Display name for an uploaded file: no directory part (either separator), no
 * control characters, no leading dots, bounded length. Used only as a label
 * and as the name sent to the Bridge — the bytes on disk live under a
 * server-generated id, so this string never reaches a filesystem path.
 */
export function sanitizeFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').trim();
  if (cleaned === '') return 'file';
  if (cleaned.length <= MAX_NAME_LENGTH) return cleaned;
  const dot = cleaned.lastIndexOf('.');
  const ext = dot > 0 && cleaned.length - dot <= 16 ? cleaned.slice(dot) : '';
  return cleaned.slice(0, MAX_NAME_LENGTH - ext.length) + ext;
}

export interface UploadInput {
  name: unknown;
  mime: unknown;
  data: unknown;
}

/**
 * Files attached to schedules, kept under `<dataDir>/attachments/<scheduleId>/`.
 * Callers pass ids of schedules that exist in the Store (server-generated
 * UUIDs), and every file is written under a fresh UUID — no client-supplied
 * string is ever used as a path segment.
 */
export class AttachmentStore {
  private readonly root: string;

  constructor(dataDir: string) {
    this.root = join(dataDir, 'attachments');
  }

  private dir(scheduleId: string): string {
    return join(this.root, scheduleId);
  }

  /** Validates the upload against the limits and writes it. Throws ValidationError / PayloadTooLargeError. */
  save(scheduleId: string, input: UploadInput, existing: readonly StoredAttachment[]): StoredAttachment {
    if (typeof input.name !== 'string' || input.name.trim() === '') throw new ValidationError('name: is required');
    if (typeof input.data !== 'string' || input.data === '') throw new ValidationError('data: is required (base64, no "data:" prefix)');
    let mime = DEFAULT_MIME;
    if (input.mime !== undefined && input.mime !== null && input.mime !== '') {
      if (typeof input.mime !== 'string' || !MIME_PATTERN.test(input.mime.trim())) throw new ValidationError('mime: must look like "image/png"');
      mime = input.mime.trim();
    }
    if (existing.length >= MAX_SCHEDULE_ATTACHMENTS) {
      throw new PayloadTooLargeError(`A schedule can have at most ${MAX_SCHEDULE_ATTACHMENTS} attachments.`);
    }
    if (input.data.length > MAX_ATTACHMENT_BASE64_LENGTH) {
      throw new PayloadTooLargeError(`"${sanitizeFileName(input.name)}" exceeds the ${MAX_ATTACHMENT_BYTES / 1_048_576} MB attachment limit.`);
    }
    if (input.data.length % 4 !== 0 || !BASE64_PATTERN.test(input.data)) throw new ValidationError('data: is not valid base64');
    const bytes = Buffer.from(input.data, 'base64');
    const name = sanitizeFileName(input.name);
    if (bytes.length === 0) throw new ValidationError('data: the file is empty');
    if (bytes.length > MAX_ATTACHMENT_BYTES) {
      throw new PayloadTooLargeError(`"${name}" exceeds the ${MAX_ATTACHMENT_BYTES / 1_048_576} MB attachment limit.`);
    }
    const total = existing.reduce((sum, a) => sum + a.size, 0) + bytes.length;
    if (total > MAX_SCHEDULE_ATTACHMENT_BYTES) {
      throw new PayloadTooLargeError(`A schedule's attachments are limited to ${MAX_SCHEDULE_ATTACHMENT_BYTES / 1_048_576} MB in total.`);
    }

    const id = randomUUID();
    const file = randomUUID();
    const dir = this.dir(scheduleId);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const target = join(dir, file);
    const tmp = `${target}.tmp`;
    writeFileSync(tmp, bytes, { mode: 0o600 });
    renameSync(tmp, target);
    chmodSync(target, 0o600);
    return { id, name, mime, size: bytes.length, file };
  }

  /** The stored bytes, or null when the file is missing from disk. */
  read(scheduleId: string, attachment: StoredAttachment): Buffer | null {
    const path = join(this.dir(scheduleId), attachment.file);
    if (!existsSync(path)) return null;
    return readFileSync(path);
  }

  remove(scheduleId: string, attachment: StoredAttachment): void {
    try {
      unlinkSync(join(this.dir(scheduleId), attachment.file));
    } catch {
      // already gone
    }
  }

  removeAll(scheduleId: string): void {
    rmSync(this.dir(scheduleId), { recursive: true, force: true });
  }
}
