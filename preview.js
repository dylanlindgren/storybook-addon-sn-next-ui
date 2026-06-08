import { addons } from 'storybook/preview-api'

import {
  THEME_GLOBAL,
  EVENT_STATUS,
  EVENT_REQUEST_STATUS,
  DEFAULT_THEMES,
  THEME_LOOKUP_ROUTE,
  themeHref,
} from './src/constants.js'
import { THEME_LINK_ID } from './src/preview-head.js'

// Build-time data injected by the preset's previewHead into the iframe window.
const boot =
  (typeof window !== 'undefined' && window.__SN_NEXT_UI__) || {
    status: {},
    themes: DEFAULT_THEMES,
  }
// Mutable: discoverThemes (on boot) merges instance themes in, and the decorator
// + toolbar resolve names against this list.
let themes = boot.themes?.length ? boot.themes : DEFAULT_THEMES
const themeByName = (name) => themes.find((t) => t.name === name) ?? themes[0]

// Registers the `snTheme` global the decorator applies. The picker itself lives
// in the manager toolbar (see manager.js) so its items can be the live-discovered
// themes — something a static globalTypes `toolbar` can't be.
export const globalTypes = {
  [THEME_GLOBAL]: {
    name: 'SN Theme',
    description: 'ServiceNow instance theme / app shell',
    defaultValue: themes[0]?.name,
  },
}

// Swap the theme stylesheet by rewriting the <link> the preview-head injected
// when the selected theme changes (no reload needed).
function applyTheme(name) {
  if (typeof document === 'undefined') return
  const link = document.getElementById(THEME_LINK_ID)
  const theme = themeByName(name)
  if (!link || !theme) return
  const href = themeHref(theme)
  if (link.getAttribute('href') !== href) {
    link.setAttribute('href', href)
    link.setAttribute('data-sn-theme', theme.name)
  }
}

const withSnTheme = (story, context) => {
  applyTheme(context.globals[THEME_GLOBAL])
  return story()
}

export const decorators = [withSnTheme]

// Relay connection status + theme list to the manager (panel + toolbar). They
// may mount after the preview boots, so also answer on-demand requests.
const channel = addons.getChannel()
const emitStatus = (extra) =>
  channel.emit(EVENT_STATUS, { status: boot.status ?? {}, themes, ...extra })
channel.on(EVENT_REQUEST_STATUS, () => emitStatus())

// Look up the instance's themes live via the preset's dev-server endpoint
// (THEME_LOOKUP_ROUTE), which shells out to `snc` — the instance's REST API
// rejects the proxy's basic-auth header, so snc (which holds usable creds) runs
// the query. Each sys_ux_theme record reuses the configured app shell's
// appConfigSysId — we swap which theme that shell renders, not the shell.
async function discoverThemes() {
  const baseAppConfigSysId = themes[0]?.appConfigSysId
  const res = await fetch(THEME_LOOKUP_ROUTE, { headers: { Accept: 'application/json' } })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || body.error) {
    throw new Error(body.error || `theme lookup failed (HTTP ${res.status})`)
  }
  const discovered = (body.result ?? [])
    .filter((r) => r.sys_id && r.name)
    .map((r) => ({ name: r.name, themeId: r.sys_id, appConfigSysId: baseAppConfigSysId }))

  // Merge discovered themes with configured ones; configured entries win on
  // matching themeId (curated name + app shell), configured-only ones append.
  const byId = new Map(discovered.map((t) => [t.themeId, t]))
  for (const t of themes) byId.set(t.themeId, t)
  themes = Array.from(byId.values())
}

// Emit the configured/default themes immediately, then enrich with a live lookup
// on boot and re-emit so the toolbar dropdown + panel pick up the merged list.
emitStatus()
if (boot.status?.proxyEnabled) {
  discoverThemes()
    .then(() => emitStatus())
    .catch((err) => emitStatus({ themesError: String(err?.message || err) }))
}

export default { globalTypes, decorators }
