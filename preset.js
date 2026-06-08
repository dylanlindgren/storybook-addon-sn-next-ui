import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { loadEnv } from 'vite'

import {
  snInstanceModules,
  snScssAsString,
  snSnabbdomJsx,
  snThemeLookup,
} from './src/vite-plugins.js'
import { resolveSncConnection, buildProxy } from './src/proxy.js'
import { renderPreviewHead } from './src/preview-head.js'
import {
  DEFAULT_COMPONENT_SRC_DIR,
  DEFAULT_PROFILE,
  DEFAULT_THEMES,
} from './src/constants.js'

// ---------------------------------------------------------------------------
// Storybook 10 preset for ServiceNow Next Experience UI components.
// Dev-time only — a stand-in for
// `snc ui-component develop --fetch-assets-from-instance`. SDK build/deploy
// never runs any of this.
//
// Consumer .storybook/main.mjs needs just framework + stories + one addon entry:
//
//   addons: [{ name: '@dylanlindgren/storybook-addon-sn-next-ui', options: {
//     componentSrcDir: 'src/now-ui',   // default; scss/jsx plugins scope here
//   }}]
// Profile and themes are configured via environment (SN_PROFILE) or
// discovered from the instance.
// ---------------------------------------------------------------------------

const require = createRequire(import.meta.url)

// NOTE: Storybook auto-loads the manager panel (./manager) and preview
// annotations (./preview) from this package's `exports` map. Don't also register
// them here via managerEntries/previewAnnotations, or each imports twice
// ("Identifier 'preview_*' has already been declared").

function resolveOptions(options) {
  const configDir = options.configDir
  if (!configDir) {
    throw new Error('[sn-next-ui] could not determine configDir from Storybook options')
  }
  const projectRoot = path.resolve(configDir, '..')
  const componentSrcDir = path.resolve(
    projectRoot,
    options.componentSrcDir ?? DEFAULT_COMPONENT_SRC_DIR,
  )
  const profile = process.env.SN_PROFILE ?? options.profile ?? DEFAULT_PROFILE
  return { projectRoot, componentSrcDir, profile }
}

// Resolve the connection + proxy once per profile. Reading the keychain secret
// prompts for Touch ID, so memoizing keeps it to one prompt per dev session
// (shared by viteFinal and previewHead).
const _connCache = new Map()
function getConnection(profile, projectRoot) {
  if (_connCache.has(profile)) return _connCache.get(profile)
  const env = { ...loadEnv('development', projectRoot, ''), ...process.env }
  const conn = resolveSncConnection({ profile, env })
  const built = buildProxy({ conn, projectRoot })
  _connCache.set(profile, built)
  return built
}

export async function viteFinal(viteConfig, options) {
  const { projectRoot, componentSrcDir, profile } = resolveOptions(options)

  viteConfig.plugins = viteConfig.plugins ?? []
  // unshift so these enforce:'pre' plugins run before Vite's own.
  viteConfig.plugins.unshift(
    snSnabbdomJsx({ componentSrcDir }),
    snInstanceModules(),
    snScssAsString({ componentSrcDir, projectRoot }),
    // Backs the panel's live theme lookup (dev-server only; no transform).
    snThemeLookup({ profile }),
  )

  // Don't pre-bundle the locally-installed @servicenow Next Experience packages (ui-core,
  // the snabbdom renderer) — snInstanceModules sources them from the instance.
  viteConfig.optimizeDeps = viteConfig.optimizeDeps ?? {}
  viteConfig.optimizeDeps.exclude = Array.from(
    new Set([
      ...(viteConfig.optimizeDeps.exclude ?? []),
      '@servicenow/ui-core',
      '@servicenow/ui-renderer-snabbdom',
    ]),
  )
  // The dep-scanner is a separate esbuild pass that still has to parse our
  // JSX-in-.js source while crawling, so give it the jsx loader for .js (parsing
  // only — snSnabbdomJsx does the real transform).
  viteConfig.optimizeDeps.esbuildOptions = {
    ...(viteConfig.optimizeDeps.esbuildOptions || {}),
    loader: {
      ...(viteConfig.optimizeDeps.esbuildOptions?.loader || {}),
      '.js': 'jsx',
    },
  }

  const { proxy } = getConnection(profile, projectRoot)
  if (proxy) {
    viteConfig.server = viteConfig.server ?? {}
    viteConfig.server.proxy = { ...(viteConfig.server.proxy ?? {}), ...proxy }
  }

  return viteConfig
}

export async function previewHead(head, options) {
  const { projectRoot, profile } = resolveOptions(options)
  const { status } = getConnection(profile, projectRoot)

  // Expose the password-free connection summary + default themes to the
  // preview iframe (read by ./preview.js, then relayed to the manager panel).
  // The preview discovers and merges the instance's live themes after boot.
  const bootData = JSON.stringify({ status, themes: DEFAULT_THEMES })
  const statusScript = `\n<script>window.__SN_NEXT_UI__ = ${bootData};</script>\n`

  return `${head}\n${renderPreviewHead(DEFAULT_THEMES[0])}${statusScript}`
}

export async function staticDirs(entry = [], options) {
  // Serve snComponentLoader.dev.js at the preview-iframe root. It's resolved
  // directly from @servicenow/cli (a dependency of this addon) so we never
  // redistribute ServiceNow's loader ourselves.
  let loaderFile
  try {
    loaderFile = require.resolve(
      '@servicenow/cli/dist/webpack-config-shared-component-folder/snComponentLoader.dev.js',
    )
  } catch (err) {
    throw new Error(
      '[sn-next-ui] Could not resolve snComponentLoader.dev.js from @servicenow/cli. ' +
        'It ships as a dependency of this addon — try reinstalling. ' +
        `Original error: ${err.message}`,
    )
  }

  return [...entry, { from: loaderFile, to: '/snComponentLoader.dev.js' }]
}
