import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

import { KEYCHAIN_SERVICE } from './constants.js'

// ---------------------------------------------------------------------------
// Build the dev-server proxy that reproduces
// `snc ui-component develop --fetch-assets-from-instance`. It proxies, each with
// `changeOrigin` and a Basic auth header:
//   * the path prefixes from now-cli.json,
//   * /uxasset — ux assets,
//   * /uxta    — ux theme assets,
//   * /amb     — the websocket channel.
//
// Connection & credential details come from the ServiceNow CLI config.
// ---------------------------------------------------------------------------

const sncConfigPath = () => path.join(os.homedir(), '.snc', 'config.json')

function readSncProfile(profile) {
  try {
    const cfg = JSON.parse(fs.readFileSync(sncConfigPath(), 'utf8'))
    return cfg?.profiles?.[profile]
  } catch {
    return undefined
  }
}

// Read a profile's basic-auth secret from the macOS login keychain. Returns the
// password, or undefined if unavailable (not macOS, no item, or prompt cancelled).
function readKeychainSecret(profile) {
  if (process.platform !== 'darwin') return undefined
  try {
    return execFileSync(
      'security',
      ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', profile, '-w'],
      { encoding: 'utf8' },
    ).replace(/\n$/, '')
  } catch {
    return undefined
  }
}

// Resolve the instance connection. Returns `ok` plus a password-free summary for
// the manager panel, and (when ok) the secret bits needed for the auth header.
export function resolveSncConnection({ profile, env }) {
  const prof = readSncProfile(profile)

  // Prefer the snc CLI config + keychain.
  if (prof?.host && prof?.username) {
    const loginmethod = prof.loginmethod || 'basic'
    if (loginmethod === 'basic') {
      const pass = readKeychainSecret(profile)
      if (pass) {
        return {
          ok: true,
          source: 'snc',
          profile,
          loginmethod,
          target: prof.host,
          user: prof.username,
          pass,
        }
      }
    }
    // Profile exists but no usable basic secret (OAuth, non-Mac, or keychain
    // unavailable) — fall through to environment variables, then report why.
    const fromEnv = fromEnvConnection(env)
    return fromEnv.ok
      ? fromEnv
      : {
        ok: false,
        source: 'snc',
        profile,
        loginmethod,
        target: prof.host,
        user: prof.username,
        reason:
          loginmethod !== 'basic'
            ? `snc profile "${profile}" uses loginmethod "${loginmethod}"; only "basic" is supported. Set SN_* environment variables to override.`
            : `Could not read the basic-auth secret for snc profile "${profile}" from the keychain (service "${KEYCHAIN_SERVICE}", account "${profile}").`,
      }
  }

  // No usable ServiceNow CLI profile — try environment variables.
  const fromEnv = fromEnvConnection(env)
  if (fromEnv.ok) return fromEnv
  return {
    ok: false,
    source: 'none',
    profile,
    reason:
      `No snc profile "${profile}" in ~/.snc/config.json and no SN_INSTANCE/` +
      `SN_USER/SN_PASS env vars set.`,
  }
}

function fromEnvConnection(env) {
  const target = env.SN_INSTANCE
  const user = env.SN_USER
  const pass = env.SN_PASS
  if (target && user && pass) {
    return { ok: true, source: 'env', target, user, pass }
  }
  return { ok: false, source: 'env' }
}

function readNowCliProxies(projectRoot) {
  try {
    const nowCli = JSON.parse(
      fs.readFileSync(path.join(projectRoot, 'now-cli.json'), 'utf8'),
    )
    return nowCli?.development?.proxy?.proxies ?? []
  } catch {
    return []
  }
}

// Build the Vite server.proxy map from a resolved connection. Returns
// { proxy, status }; `status` is a password-free summary for the panel, and
// `proxy` is undefined when the connection isn't usable.
export function buildProxy({ conn, projectRoot }) {
  const status = {
    proxyEnabled: false,
    source: conn.source,
    profile: conn.profile,
    target: conn.target,
    user: conn.user,
    loginmethod: conn.loginmethod,
    reason: conn.reason,
  }

  if (!conn.ok) {
    console.warn(
      `[sn-next-ui] instance proxy disabled — ${conn.reason}\n` +
      '            The Next Experience runtime, components, and theme all load from ' +
      'the instance, so nothing will render until this is resolved.',
    )
    return { proxy: undefined, status }
  }

  const configured = readNowCliProxies(projectRoot)
  // All over the same authed HTTP proxy: /uxasset and /uxta.
  const httpPrefixes = Array.from(new Set([...configured, '/uxasset', '/uxta']))

  // Origin header keeps Glide's CORS policy happy (set to the instance URL);
  // changeOrigin rewrites the Host header to match.
  const headers = {
    Authorization: `Basic ${Buffer.from(`${conn.user}:${conn.pass}`).toString('base64')}`,
    origin: conn.target,
  }

  const proxy = {}
  for (const prefix of httpPrefixes) {
    proxy[prefix] = {
      target: conn.target,
      changeOrigin: true,
      secure: true,
      headers
    }
  }
  // The AMB realtime channel is a websocket.
  proxy['/amb'] = {
    target: conn.target,
    changeOrigin: true,
    secure: true,
    ws: true,
    headers,
  }

  status.proxyEnabled = true
  status.prefixes = [...httpPrefixes, '/amb']
  return { proxy, status }
}
