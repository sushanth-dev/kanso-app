/**
 * The API origin the browser calls. In production the bundle bakes in
 * `VITE_API_URL` (the deployed API hostname); unset, it falls back to the
 * page's own origin, so local dev keeps the Vite proxy unchanged.
 */
const configuredApiUrl = import.meta.env.VITE_API_URL as string | undefined;

export const apiBaseUrl = configuredApiUrl ?? window.location.origin;
