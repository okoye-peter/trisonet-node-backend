/**
 * Tables shared with the PHP app store naive timestamps in PHP's timezone (config/app.php:
 * Africa/Lagos), while Prisma reads/writes DateTime as UTC. Use these helpers for columns that
 * both apps compare against "now" (e.g. auth_handoff_tokens.expires_at), so both sides agree.
 */
const PHP_TIMEZONE = process.env.PHP_APP_TIMEZONE || "Africa/Lagos";

const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: PHP_TIMEZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
});

/** The given instant expressed as PHP's wall-clock time, in the form Prisma will store verbatim. */
export const toPhpWallClock = (date: Date = new Date()): Date => {
    const p = Object.fromEntries(formatter.formatToParts(date).map((x) => [x.type, x.value]));
    return new Date(Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!));
};
