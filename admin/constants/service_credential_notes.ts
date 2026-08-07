import { SERVICE_NAMES } from './service_names.js'

/**
 * Sign-in notes for bundled apps that ship with their own built-in default
 * login. Surfaced on the Supply Depot app card so a fresh install isn't
 * stranded at an app's login screen with no idea what the credentials are.
 * Keyed by service_name; an app with no entry shows nothing.
 *
 * Grocy (the LinuxServer image) ships Grocy's factory default, and NOMAD sets
 * no credentials of its own, so that default applies until the user changes it.
 *
 * These notes describe credentials the apps seed themselves and publish in
 * their own documentation — showing them here neither creates nor widens any
 * exposure, it just tells the owner of the box what is already true so they
 * can change it. NOMAD never sets, stores, or transmits a password of its own.
 */
export const SERVICE_CREDENTIAL_NOTES: Record<string, string> = {
  [SERVICE_NAMES.GROCY]: 'Default login: admin / admin. Change it in Grocy after your first sign-in.',
  // calibre-web seeds this itself on first run: cps/ub.py create_admin_user()
  // hashes cps/constants.py DEFAULT_PASSWORD (read at tag 0.6.26, the pinned image).
  [SERVICE_NAMES.CALIBRE_WEB]:
    'Default login: admin / admin123. Change it in Admin → Users after your first sign-in.',
}
