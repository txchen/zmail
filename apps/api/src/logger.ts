type LogFields = Record<string, boolean | number | string | undefined>;

export function logInfo(event: string, fields: LogFields = {}): void {
  console.log(formatLog("info", event, fields));
}

export function logWarn(event: string, fields: LogFields = {}): void {
  console.warn(formatLog("warn", event, fields));
}

export function logError(event: string, fields: LogFields = {}): void {
  console.error(formatLog("error", event, fields));
}

function formatLog(level: string, event: string, fields: LogFields): string {
  const serializedFields = Object.entries(fields)
    .filter((entry): entry is [string, boolean | number | string] => entry[1] !== undefined)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(" ");

  return [
    `ts=${JSON.stringify(new Date().toISOString())}`,
    `level=${level}`,
    `event=${event}`,
    serializedFields,
  ]
    .filter(Boolean)
    .join(" ");
}
