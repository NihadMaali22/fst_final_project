import { CursorPayload } from '../models/types.js';
export declare function encodeCursor(ts: string, id: string): string;
export declare function decodeCursor(cursor: string): CursorPayload | null;
