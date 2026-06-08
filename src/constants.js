// Shared constants, imported by both the Node preset and the browser
// manager/preview. Keep it pure data — no node- or browser-only imports.

export const ADDON_ID = 'sn-next-ui'
export const PANEL_ID = `${ADDON_ID}/panel`
export const TOOL_ID = `${ADDON_ID}/toolbar`
export const THEME_GLOBAL = 'snTheme'

// Preview -> manager: connection status + current theme list. Re-emitted after
// the preview discovers the instance's live themes on boot.
export const EVENT_STATUS = `${ADDON_ID}/status`
// Manager -> preview: re-emit status (panel/toolbar mounted after preview boot).
export const EVENT_REQUEST_STATUS = `${ADDON_ID}/request-status`

// Instance table the theme lookup reads: sys_id -> themeId, name -> label.
export const THEME_TABLE = 'sys_ux_theme'

// Dev-server route the preview fetches to discover themes. A preset middleware
// answers it via the `snc` CLI (see src/vite-plugins.js): REST here needs snc's
// token, not the proxy's basic-auth header, so the browser can't hit /api directly.
export const THEME_LOOKUP_ROUTE = '/__sn-next-ui/themes'

// Project component source, relative to the consumer root. The scss + jsx
// plugins scope to this directory.
export const DEFAULT_COMPONENT_SRC_DIR = 'src/now-ui'

// Default `~/.snc` connection profile to read host/username from.
export const DEFAULT_PROFILE = 'default'

// macOS keychain coordinates the snc CLI uses for the basic-auth secret:
// generic password, service `snc`, account = the profile name.
export const KEYCHAIN_SERVICE = 'snc'

// Default app shell / theme. The preview discovers and merges the instance's
// live themes after boot, so this is just an initial bootstrap value.
export const DEFAULT_THEMES = [
  {
    name: 'Polaris',
    appConfigSysId: 'e42a5af4c700201072b211d4d8c2607c',
    themeId: '31bf91ae07203010e03948f78ad30095',
  },
]

// Build the instance theme stylesheet URL (served via the /$uxappimmutables.do
// proxy). Built raw, no percent-encoding — the instance expects this exact query
// string verbatim.
export function themeHref(theme) {
  const query = [
    'sysparm_request_type=ux_theme',
    `sysparm_app_config_sys_id=${theme.appConfigSysId}`,
    `themeId=${theme.themeId}`,
    `sysparm_use_cache_buster=false`,
    'deviceAdaptiveStyles=true',
  ].join('&')
  return `/$uxappimmutables.do?${query}`
}
