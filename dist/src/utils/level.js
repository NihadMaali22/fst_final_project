const LEVEL_MAP = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};
const REVERSE_LEVEL_MAP = {
    0: 'debug',
    1: 'info',
    2: 'warn',
    3: 'error',
};
export function levelToSmallInt(level) {
    return LEVEL_MAP[level];
}
export function smallIntToLevel(val) {
    return REVERSE_LEVEL_MAP[val] || 'info';
}
export function isValidLogLevel(level) {
    return typeof level === 'string' && level in LEVEL_MAP;
}
