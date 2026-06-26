import { SERVICE_NAMES } from './service_names.js'

/**
 * Sign-in notes for bundled apps that ship with their own built-in default
 * login. Surfaced on the Supply Depot app card so a fresh install isn't
 * stranded at an app's login screen with no idea what the credentials are.
 * Keyed by service_name; an app with no entry shows nothing.
 *
 * Grocy (the LinuxServer image) ships Grocy's factory default, and NOMAD sets
 * no credentials of its own, so that default applies until the user changes it.
 */
export const SERVICE_CREDENTIAL_NOTES: Record<string, string> = {
  [SERVICE_NAMES.GROCY]: 'Default login: admin / admin. Change it in Grocy after your first sign-in.',
}
