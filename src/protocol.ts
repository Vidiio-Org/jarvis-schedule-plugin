/** JSONL sidecar protocol over stdin/stdout — same shape as the sibling plugins. */

export interface HostEvent {
  type: string;
  settings?: Record<string, string>;
  [key: string]: unknown;
}

export type OutMessage =
  | { type: 'ready'; name?: string }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string }
  | { type: 'error'; message: string };

/** Parses one stdin line; null for anything that is not a well-formed event (never throws). */
export function parseEventLine(line: string): HostEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const evt = value as Record<string, unknown>;
  if (typeof evt.type !== 'string') return null;
  return evt as HostEvent;
}

const MAX_LOG_CHARS = 500;

export class Emitter {
  constructor(private readonly stream: { write(chunk: string): unknown }) {}

  send(message: OutMessage): void {
    this.stream.write(`${JSON.stringify(message)}\n`);
  }

  log(level: 'info' | 'warn' | 'error', message: string): void {
    // The host shows at most 500 characters per log line.
    this.send({ type: 'log', level, message: message.length > MAX_LOG_CHARS ? `${message.slice(0, MAX_LOG_CHARS - 1)}…` : message });
  }
}
