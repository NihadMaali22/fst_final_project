const LEVEL_MAP = {
    debug: 0,
    info: 1,
    warn: 2,
    warning: 2,
    error: 3,
    fatal: 3,
};
const REVERSE_LEVEL_MAP = {
    0: 'debug',
    1: 'info',
    2: 'warn',
    3: 'error',
};
export function levelToSmallInt(level) {
    if (typeof level !== 'string')
        return 1;
    return LEVEL_MAP[level.toLowerCase()] ?? 1;
}
export function smallIntToLevel(val) {
    return REVERSE_LEVEL_MAP[val] || 'info';
}
export function isValidLogLevel(level) {
    if (typeof level !== 'string')
        return false;
    return level.toLowerCase() in LEVEL_MAP;
}
export function normalizeLevel(level) {
    const lower = level.toLowerCase();
    const num = LEVEL_MAP[lower];
    return REVERSE_LEVEL_MAP[num] ?? 'info';
}
