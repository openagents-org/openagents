# Linux ARM64 Launcher

The Linux release build produces AppImage and Debian packages for both x64
and ARM64. ARM64 builds run natively on `ubuntu-24.04-arm` in GitHub Actions.
Choose the `linux-arm64` asset from [GitHub Releases](https://github.com/openagents-org/openagents/releases).
These packages contain the Launcher and its embedded Workspace frontend, not
the self-hosted Workspace backend or PostgreSQL.

## Build from source

On Linux ARM64, install ARM64 Node.js 22.12+ (Node.js 22 LTS is used in CI),
npm and Git. Run these commands from the repository root:

```sh
npm --prefix workspace/frontend install
npm --prefix packages/launcher install
npm --prefix packages/launcher run build:linux:arm64
```

The build produces the following files under `packages/launcher/dist/`:

- `OpenAgents-<version>-linux-arm64.AppImage`
- `OpenAgents-<version>-linux-arm64.deb`
- `latest-linux-arm64.yml` (AppImage update metadata)
- `linux-arm64-unpacked/` (complete unpacked application)

The existing `build:linux`, the Linux part of `build:all`, and `dist` on Linux
continue to target x64, including on ARM64 hosts. `build:linux:x64` explicitly
builds x64; `build:linux:arm64` explicitly builds ARM64. The explicit commands
supply both installer targets so electron-builder does not mix in the configured
x64 defaults. Native builds are recommended so npm installs the appropriate
native optional dependencies. Use the existing
`ELECTRON_MIRROR` and `ELECTRON_BUILDER_BINARIES_MIRROR` environment variables
if downloads require a mirror; no global npm configuration change is needed.

To produce only an unpacked application after installing dependencies:

```sh
cd packages/launcher
npm run build
npx --no-install electron-builder --linux --arm64 --dir --publish never
```

Keep the complete unpacked directory, including `resources/`; copying only
the `openagents` executable is insufficient. First launch still needs network
access to provision the portable Node.js runtime and agent launcher core.

## Run and update

Install the Debian package with your distribution's package manager, or make
the AppImage executable and run it in a Linux desktop session. AppImage may
require the distribution's FUSE 2 compatibility package.

AppImage updates use `latest-linux-arm64.yml`; x64 continues to use
`latest-linux.yml`. Both manifests and their referenced installers must be
published to the update feed. Debian and unpacked installations use manual
updates, as on x64.

If a particular graphics driver causes text corruption, try launching with
`--ozone-platform=x11 --disable-gpu` in a session with X11/XWayland available.
This is an optional diagnostic for affected systems, not an ARM64 default.
Do not disable Chromium's sandbox to work around graphics problems.

CI checks the Electron and AppImage ELF architectures, Debian architecture,
embedded resources, and architecture-specific update metadata before uploading
artifacts. The release job also verifies installer hashes and blockmaps. These
checks do not replace testing graphical startup and agent workflows on the
target device.

The architecture regression tests run as part of `npm test` and before Linux
release builds. They parse the actual npm build commands and check both x64
and ARM64 host architectures, including the existing default build commands.
The release job requires both named Linux artifacts before publishing.
