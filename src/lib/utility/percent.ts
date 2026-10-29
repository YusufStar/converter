// Everyday percentage maths. Division by zero yields NaN (shown as "—").

const safe = (x: number) => (Number.isFinite(x) ? x : NaN);

/** X% of Y */
export const percentOf = (p: number, n: number) => (p / 100) * n;
/** X is what % of Y */
export const whatPercent = (part: number, total: number) => safe((part / total) * 100);
/** % change from X to Y (relative to |X|) */
export const percentChange = (from: number, to: number) => safe(((to - from) / Math.abs(from)) * 100);
/** Y ± X% */
export const addPercent = (n: number, p: number) => n + (n * p) / 100;
