/**
 * Which HTTP origins may call this API. CORS_ORIGIN holds a comma-separated
 * allowlist; without it only the local Expo dev origin is accepted.
 */
export function resolveAllowedOrigins(env: NodeJS.ProcessEnv): string[] {
  return (env.CORS_ORIGIN ?? 'http://localhost:8081,http://localhost:19006')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}
