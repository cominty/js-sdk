# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

While the version is `0.x`, a minor release may contain breaking changes; they
are always called out under **Changed** or **Removed**.

## [Unreleased]

## [0.1.0] - 2026-09-28

First public release.

### Added

- `Cominty` client, configured by options or the `COMINTY_API_KEY`,
  `COMINTY_USER_ID` and `COMINTY_BASE_URL` environment variables.
- `client.chat.start`, `client.chat.send` and `client.chat.stream`, returning a
  run you can iterate for progress events or await for the final message.
- `client.threads.list`, `get`, `update` and `archive`.
- Typed stream events as a discriminated union, with `isKnownEvent` for
  forward compatibility.
- Typed error hierarchy rooted at `ComintyError`.
- Client-side parameter validation that reports every invalid argument at once.

[Unreleased]: https://github.com/cominty/js-sdk/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/cominty/js-sdk/releases/tag/v0.1.0
