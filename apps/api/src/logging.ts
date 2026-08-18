/**
 * Structured logging: one JSON line per event, queryable with CloudWatch Logs
 * Insights. No logger dependency; `console` is the sink and CloudWatch keeps
 * it. The `requestId` field is added by each caller where a context exists,
 * because not every log site has one (the queue no-op warning is process
 * level). Stable event names replace the ad-hoc strings so a query can ask for
 * one event rather than grepping prose.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export function log(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ level, event, ...fields });
  switch (level) {
    case 'error':
      console.error(line);
      break;
    case 'warn':
      console.warn(line);
      break;
    case 'debug':
      console.debug(line);
      break;
    default:
      console.info(line);
  }
}
