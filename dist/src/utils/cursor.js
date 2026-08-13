import { isValidIso8601 } from './time.js';
export function encodeCursor(ts, id) {
    const payload = { ts, id };
    return Buffer.from(JSON.stringify(payload)).toString('base64url');
}
export function decodeCursor(cursor) {
    try {
        const raw = Buffer.from(cursor, 'base64url').toString('utf8');
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object')
            return null;
        if (typeof parsed.ts !== 'string' || typeof parsed.id !== 'string')
            return null;
        if (!isValidIso8601(parsed.ts))
            return null;
        if (!/^\d+$/.test(parsed.id))
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
