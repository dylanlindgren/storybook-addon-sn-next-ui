# @dylanlindgren/storybook-addon-sn-next-ui

## Modern component development for ServiceNow Next Experience

Develop **ServiceNow Next Experience** UI components in **[Storybook](https://storybook.js.org)** with full local preview, hot reload, and no instance integration friction. Components render against the real Next Experience runtime and your instance's live theme assets – not mocks.

### What you get

- **Storybook's full power** – interactive development with instant hot reload, isolated testing without booting the instance, and the full addon ecosystem for docs and accessibility.
- **Real instance rendering** – components render with the actual Next Experience runtime, using live theme assets discovered from your instance so you can test across every theme.
- **Frictionless setup** – connect once via the ServiceNow CLI and credentials are handled for you. Standard Storybook workflows, plus a **ServiceNow Theme** toolbar to switch themes live and a connection panel showing instance status.

## Get started in 2 minutes

Install the addon and its peer dependencies:

```sh
pnpm add -D @dylanlindgren/storybook-addon-sn-next-ui \
  storybook@^10 @storybook/web-components-vite@^10 \
  vite@'^5 || ^6 || ^7' sass@'>=1.50' \
  react@'^16.8 || ^17 || ^18 || ^19'
```

Then configure it below.

## Configure the addon

Add the following to `.storybook/main.mjs`:

```js
/** @type {import('@storybook/web-components-vite').StorybookConfig} */
export default {
  framework: '@storybook/web-components-vite',
  stories: ['../stories/**/*.stories.@(js|jsx|mjs)'],
  addons: [
    {
      name: '@dylanlindgren/storybook-addon-sn-next-ui',
      options: {
        // Where your component source lives relative to the project root. 
        // Default: 'src/now-ui'.
        componentSrcDir: 'src/now-ui',
      },
    },
  ],
  core: { disableTelemetry: true },
}
```

That's it – the addon handles everything else.

Run `pnpm storybook` and you're done.

## Write a story

Stories are plain [Storybook web-components stories](https://github.com/storybookjs/storybook/blob/next/docs/get-started/whats-a-story.mdx). Import your component registry so its custom elements register, then render the element by tag and drive it through attributes and events:

```js
// stories/my-component.stories.js
// Importing the registry registers every component's custom element.
import '../src/now-ui'
import { action } from 'storybook/actions'

const TAG = 'snc-test-sdk-component'

export default {
  title: 'Components/snc-test-sdk-component',
  tags: ['autodocs'],
  render: (args) => {
    const el = document.createElement(TAG)
    // Primitive props map to kebab-case custom-element attributes.
    el.setAttribute('button-size', String(args.buttonSize))
    // ui-core dispatches bubbling, composed CustomEvents; detail is
    // { type, payload, error, meta }. Log just the payload.
    el.addEventListener('SNC-TEST-SDK-COMPONENT#ITEM_SELECTED', (e) => {
      action('ITEM_SELECTED')(e.detail?.payload)
    })
    return el
  },
  argTypes: {
    buttonSize: { control: { type: 'select' }, options: ['sm', 'md', 'lg'] },
  },
  args: { buttonSize: 'md' },
}

export const Default = {}
export const Large = { args: { buttonSize: 'lg' } }
```

Switch instance themes live from the **ServiceNow Theme** toolbar while you develop.

## Instance & credentials

There are two ways the addon connects to your instance. It tries the ServiceNow CLI first, then falls back to environment variables.

### 1. ServiceNow CLI (default, recommended)

The addon reads your instance host and username from the ServiceNow CLI config (`~/.snc/config.json`) and the basic-auth password from your **macOS keychain** — the same credentials `snc` already manages. Nothing extra to configure.

```sh
pnpm exec snc configure profile set   # creates the default profile
```

- Uses the profile named `default`. To use a different one, create it with `snc configure profile set --profile my-instance-profile`, then set `SN_PROFILE` in a `.env` file at your project root:
  ```
  SN_PROFILE=my-instance-profile
  ```
- Requires a `basic` login method, and the keychain lookup is **macOS only**. For OAuth profiles, non-macOS platforms, or if the keychain isn't available, use environment variables instead (below).

### 2. Environment variables (fallback)

Set all three in `.env` or your shell:

```
SN_INSTANCE=your-instance.service-now.com
SN_USER=your.user@servicenow.com
SN_PASS=your-password-or-token
```

These take over whenever the CLI path can't provide usable credentials.

Either way, credentials stay server-side — they're attached to the dev-server proxy and never sent to the browser. If the connection can't be resolved, the addon logs a clear error explaining exactly what's missing.

## Links

- **Repository:** https://github.com/dylanlindgren/storybook-addon-sn-next-ui
- **Issues:** https://github.com/dylanlindgren/storybook-addon-sn-next-ui/issues
- **License:** [MIT](./LICENSE)