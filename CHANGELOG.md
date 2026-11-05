# Changelog

All notable changes to Tasks are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

Each release's section is also its GitHub release notes: the release workflow reads this file when a release is cut. Write the notes under
`## [Unreleased]` as you go; a release turns them into the version's section.

## [Unreleased]

### Added

- The repository's conventions: licence, contributing guide, pull request template and dependency updates.
- Formatting with Prettier, linting with ESLint, and tests with Vitest.
- Continuous integration, which runs only what a change can affect.
- Settings are read in one place and checked at start-up: the server stops, naming the setting and never its value, on a wrong address, a partial set of related settings, or an SMTP host with no sender. `.env.example` lists every setting.

### Removed

- The scaffold's notes example, its sign-in and its database code.
