import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { transformWithEsbuild } from 'vite'

import { MEGA_PACKAGES, externalUrlFor } from './mega-tables.js'
import { THEME_TABLE, THEME_LOOKUP_ROUTE } from './constants.js'

// ---------------------------------------------------------------------------
// The three Vite plugins that make a ServiceNow Next Experience
// component project work under Storybook 10 / @storybook/web-components-vite.
// All three are DEV-TIME only; the SDK build/deploy flows never run them.
//
// Architecture (see README): bundle the project's OWN component source locally
// for fast HMR, but load everything under @servicenow/* and @devsnc/* from the
// instance over the dev proxy.
//
// === Single-instance constraint — do not break this ===
// Everything under @servicenow/* and @devsnc/* must resolve to the one copy the
// instance provides, loaded from its exact runtime URL with no query string.
// Loading any of it a second time, or from a different URL, breaks the components
// at runtime. The `new Function('u','return import(u)')` trick below exists
// precisely so Vite's import-analysis never sees — and never rewrites/appends
// `?import` to — that URL.
// ---------------------------------------------------------------------------

// Build a `require` scoped to the consumer project so peer deps (e.g. `sass`)
// resolve from the consumer's node_modules, not the addon's.
const requireFrom = (projectRoot) =>
  createRequire(path.join(projectRoot, 'package.json'))

// Resolve every @servicenow/* and @devsnc/* import to a virtual module that
// loads it from the INSTANCE at runtime and re-exports it. Platform packages are
// pulled from the shared instance bundle; everything else loads its own module.
//
// Loaded via `new Function('u','return import(u)')` so the `import(u)` lives in a
// string the Vite import-analysis lexer never sees. A normal dynamic import
// doesn't work here: Vite resolves a static "/uxasset/..." string from disk
// (fails), and for a non-static specifier it ALWAYS wraps it in
// __vite__injectQuery(..., 'import'), appending `?import`. That changed URL would
// load a second, separate copy instead of the instance's own — breaking the
// single-instance constraint above. The URL must be identical. Top-level await
// ensures the instance module is ready before the importer runs.
export function snInstanceModules() {
  const PREFIX = '\0sn-instance:'
  const SCOPE_RE = /^@(servicenow|devsnc)\//
  const megaUrl = JSON.stringify(externalUrlFor('@servicenow/ui-mega'))
  return {
    name: 'sn-instance-modules',
    enforce: 'pre',
    resolveId(source) {
      return SCOPE_RE.test(source) ? PREFIX + source : null
    },
    load(id) {
      if (!id.startsWith(PREFIX)) return null
      const pkg = id.slice(PREFIX.length)
      const platform = MEGA_PACKAGES[pkg]
      const lines = [
        `const __import = new Function('u', 'return import(u)');`,
        `const __origin = new URL(import.meta.url).origin;`,
      ]
      if (platform) {
        // Platform package: pull its namespace out of the shared instance bundle.
        lines.push(`const __mega = await __import(__origin + ${megaUrl});`)
        lines.push(`const __ns = __mega[${JSON.stringify(platform.namespace)}];`)
        for (const name of platform.names) {
          lines.push(`export const ${name} = __ns[${JSON.stringify(name)}];`)
        }
        if (platform.hasDefault) {
          lines.push(`export default __ns["default"] ?? __ns;`)
        }
      } else {
        // Component / other instance package: load its own module (registers
        // custom elements as a side effect; default re-exported if present).
        const url = JSON.stringify(externalUrlFor(pkg))
        lines.push(`const __ns = await __import(__origin + ${url});`)
        lines.push(`export default __ns && (__ns.default ?? __ns);`)
      }
      return lines.join('\n') + '\n'
    },
  }
}

// Components do `import styles from './index.scss'` and hand the result to
// `styles:` as a string. We compile the project's .scss to a CSS string here
// (returning `export default "<css>"`) using the project's OWN installed sass
// (compileString). This deliberately bypasses Vite's built-in sass worker, which
// only supports the modern-compiler API (sass >= 1.70) — SDK projects can pin an
// older sass, and bumping it (or adding sass-embedded) would alter the SDK
// `build`. Scoped to the component source dir; Storybook's CSS is untouched.
export function snScssAsString({ componentSrcDir, projectRoot }) {
  // Resolve project .scss to a \0-prefixed virtual module whose id carries no
  // ".scss" substring (path is hex-encoded), so Vite's core `vite:css`
  // transform — which matches on the .scss extension — never touches it. We
  // compile it ourselves in `load`.
  const PREFIX = '\0sn-scss:'
  let compileString
  return {
    name: 'sn-scss-as-string',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!source.endsWith('.scss')) return null
      const resolved = await this.resolve(source, importer, {
        ...options,
        skipSelf: true,
      })
      const file = resolved?.id.split('?')[0]
      if (!file || !file.startsWith(componentSrcDir)) return null
      return PREFIX + Buffer.from(file).toString('hex')
    },
    load(id) {
      if (!id.startsWith(PREFIX)) return null
      const file = Buffer.from(id.slice(PREFIX.length), 'hex').toString('utf8')
      if (!compileString) {
        compileString = requireFrom(projectRoot)('sass').compileString
      }
      const source = fs.readFileSync(file, 'utf8')
      const { css } = compileString(source, {
        loadPaths: [path.dirname(file)],
        url: pathToFileURL(file),
      })
      this.addWatchFile(file)
      return { code: `export default ${JSON.stringify(css)}`, map: null }
    },
  }
}

// Compile the project's snabbdom JSX (classic pragma) for .js component source.
// We do the transform AND the factory import in one plugin instead of Vite's
// `esbuild`/`jsxInject` option, because Vite only injects jsxInject for
// .jsx/.tsx ids (jsxExtensionsRE) — never for .js — so the factory would be
// referenced but never imported. The pragma names are aliased so they don't
// collide with the `import { Fragment }` that component files already declare;
// they resolve (via snInstanceModules) to the instance renderer's
// createElement/Fragment, the same realm as the rest of the component.
export function snSnabbdomJsx({ componentSrcDir }) {
  const FACTORY = '__snCreateElement'
  const FRAGMENT = '__snFragment'
  const inject =
    `import { createElement as ${FACTORY}, Fragment as ${FRAGMENT} }` +
    ` from '@servicenow/ui-renderer-snabbdom';`
  return {
    name: 'sn-snabbdom-jsx',
    enforce: 'pre',
    async transform(code, id) {
      const file = id.split('?')[0]
      if (!/\.jsx?$/.test(file)) return null
      if (!file.startsWith(componentSrcDir)) return null
      const result = await transformWithEsbuild(`${inject}\n${code}`, id, {
        loader: 'jsx',
        jsx: 'transform',
        jsxFactory: FACTORY,
        jsxFragment: FRAGMENT,
        sourcemap: true,
      })
      return { code: result.code, map: result.map }
    },
  }
}

// Dev-server endpoint backing the preview's boot-time theme discovery. It
// shells out to the `snc` CLI. Responds at THEME_LOOKUP_ROUTE with the raw 
// snc payload (`{ result: [{ sys_id, name }] }`) or `{ error }` on failure.
export function snThemeLookup({ profile }) {
  return {
    name: 'sn-theme-lookup',
    configureServer(server) {
      server.middlewares.use(THEME_LOOKUP_ROUTE, (_req, res) => {
        const fail = (status, error) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error }))
        }
        execFile(
          'snc',
          [
            'record', 'query',
            '-t', THEME_TABLE,
            '--fields', 'sys_id,name',
            '--limit', '200',
            '-q', 'ORDERBYname',
            '-p', profile,
            '-o', 'json',
            '--no-interactive', '--no-verbose',
          ],
          { timeout: 30000, maxBuffer: 4 * 1024 * 1024 },
          (err, stdout, stderr) => {
            if (err) {
              const detail = String(stderr || err.message).trim()
              return fail(
                502,
                err.code === 'ENOENT'
                  ? 'snc CLI not found on PATH (needed to look up themes).'
                  : `snc theme lookup failed: ${detail}`,
              )
            }
            // snc prints only the JSON payload to stdout when non-interactive, but
            // guard against any leading/trailing noise before parsing.
            const text = String(stdout)
            const start = text.indexOf('{')
            const end = text.lastIndexOf('}')
            let body
            try {
              body = JSON.parse(text.slice(start, end + 1))
            } catch {
              return fail(502, 'Could not parse the theme list returned by snc.')
            }
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ result: body.result ?? [] }))
          },
        )
      })
    },
  }
}
