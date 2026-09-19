/** JSONL sidecar protocol over stdin/stdout — same shape as the sibling plugins. */
/** Parses one stdin line; null for anything that is not a well-formed event (never throws). */
export function parseEventLine(line) {
    const trimmed = line.trim();
    if (!trimmed)
        return null;
    let value;
    try {
        value = JSON.parse(trimmed);
    }
    catch {
        return null;
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return null;
    const evt = value;
    if (typeof evt.type !== 'string')
        return null;
    return evt;
}
export class Emitter {
    stream;
    constructor(stream) {
        this.stream = stream;
    }
    send(message) {
        this.stream.write(`${JSON.stringify(message)}\n`);
    }
    log(level, message) {
        this.send({ type: 'log', level, message });
    }
}
