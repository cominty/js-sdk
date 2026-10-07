# Contributing

Thanks for helping improve the Cominty TypeScript SDK. Bug reports, fixes, docs
improvements and feature proposals are all welcome.

For anything larger than a small fix, please
[open an issue](https://github.com/cominty/js-sdk/issues/new/choose) first so we
can agree on the approach before you invest time in it.

## Setup

You need **Node 22.12+** and **pnpm** to develop. (The published package supports
Node 20+; the newer version is only required by the test runner.)

```bash
git clone https://github.com/cominty/js-sdk.git
cd js-sdk
corepack enable      # provides the pnpm version pinned in package.json
pnpm install
```

## Everyday commands

| Command | What it does |
| --- | --- |
| `pnpm test` | Run the test suite once |
| `pnpm test:watch` | Re-run tests on change |
| `pnpm check` | Type-check `src/` and `examples/` |
| `pnpm lint` | Lint and check formatting (what CI runs) |
| `pnpm format` | Fix formatting and auto-fixable lint issues |
| `pnpm build` | Compile `src/` to `dist/` |
| `pnpm smoke` | Install the packed tarball in a temp project and exercise it |

Tests never touch the network: `fetch` is injected and mocked (see
[`src/test-utils.ts`](src/test-utils.ts)). The scripts in [`examples/`](examples/)
are the opposite — they call the real API and spend real credits.

## Project layout

```
src/
├── index.ts         Public exports — the package's entire API surface
├── client.ts        The Cominty class
├── config.ts        Option and environment resolution
├── transport.ts     fetch, auth header, error mapping, JSONL framing
├── streaming.ts     AssistantRun — classifies stream lines into events and the final message
├── events.ts        Stream event types
├── errors.ts        Error hierarchy
├── models/          Request/response types, validation, camelCase → snake_case mapping
└── resources/       client.chat, client.threads and client.memory
```

## Guidelines

- **No runtime dependencies.** The SDK uses only platform APIs (`fetch`,
  `ReadableStream`, `AbortController`). A pull request that adds one needs a very
  strong reason.
- **Anything exported from `src/index.ts` is public API.** Changing or removing
  it is a breaking change. Keep internals unexported.
- **Validate requests strictly, type responses loosely.** Bad arguments should
  throw `InvalidParams` before a request is sent; response types should tolerate
  fields the server adds later.
- **Every behaviour change needs a test**, and every user-visible change needs a
  line in [`CHANGELOG.md`](CHANGELOG.md) under **Unreleased**.
- **Update the docs in the same pull request** — [`README.md`](README.md) and
  [`docs/`](docs/).

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Make your change, with tests.
3. Run `pnpm format && pnpm check && pnpm test`.
4. Open the pull request and describe what changed and why.

CI runs lint, type-check, tests and build on Node 22, 24 and 26, then installs
the packed tarball on Node 20 through 26.

## Releasing

_For maintainers._

Releases are published to npm by
[`.github/workflows/release.yml`](.github/workflows/release.yml) when a GitHub
release is published. It authenticates with
[npm trusted publishing](https://docs.npmjs.com/trusted-publishers), so there is
no npm token to store or rotate, and every release carries a provenance
attestation.

### To cut a release

1. Update `version` in `package.json`.
2. In `CHANGELOG.md`, move the **Unreleased** entries under a new version
   heading with today's date, and update the comparison links at the bottom.
3. Commit as `release: vX.Y.Z` and merge to `main`.
4. Create a GitHub release with the tag `vX.Y.Z` (it must match `package.json`)
   and paste the changelog entries as the notes.

Tick **Set as a pre-release** to publish under the `next` dist-tag instead of
`latest`.

### One-time setup

Trusted publishing is configured per package on npmjs.com, so the package must
exist before it can be enabled:

1. Publish the first version by hand from a clean checkout of `main`:
   ```bash
   npm login
   pnpm install --frozen-lockfile
   npm publish
   ```
2. On npmjs.com, open the package → **Settings** → **Trusted Publisher** →
   **GitHub Actions**, and enter organization `cominty`, repository `js-sdk`,
   workflow `release.yml`, environment `npm`.
3. In the GitHub repository, create an environment named `npm` under
   **Settings → Environments**. Adding required reviewers there makes every
   publish wait for approval.
4. Optionally, in the package's npm settings, require two-factor authentication
   and disallow tokens so the workflow is the only way to publish.
