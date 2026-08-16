export function formatUrlHost(host: string): string {
  if (!host.includes(":") || host.startsWith("[")) {
    return host;
  }

  return `[${host}]`;
}
