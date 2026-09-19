import { describe, expect, it } from 'vitest';

import { Emitter } from '../src/protocol.js';

describe('Emitter.log', () => {
  it('keeps log lines within the 500 characters the host displays, on one JSON line', () => {
    const out: string[] = [];
    const emitter = new Emitter({ write: (c: string) => out.push(c) });
    emitter.log('error', `boom\n${'x'.repeat(2000)}`);
    emitter.log('info', 'short');
    expect(out).toHaveLength(2);
    const long = JSON.parse(out[0]!) as { type: string; level: string; message: string };
    expect(long).toMatchObject({ type: 'log', level: 'error' });
    expect(long.message.length).toBe(500);
    expect(out[0]!.trimEnd().includes('\n')).toBe(false);
    expect(JSON.parse(out[1]!)).toMatchObject({ message: 'short' });
  });
});
