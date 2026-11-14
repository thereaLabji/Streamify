# Streamify OBS Plugin (Windows first)

This is the native OBS Studio integration for Streamify. It adds a **Streamify** dock inside OBS (View → Docks → Streamify).

## Current MVP

- Native OBS frontend dock (not a browser dock).
- Reads Streamify Core at `http://127.0.0.1:47821`.
- Shows Core availability, OBS WebSocket connection, live/offline state, and diagnostics.
- Refreshes every five seconds and has a manual refresh button.
- Read-only: it does not change scenes, start/stop a stream or recording, or modify OBS settings.
- Does not contain or request stream keys, OBS passwords, pairing codes, or Cloudflare tokens.

The plugin expects Streamify Core to be installed and running on the same Windows PC. Core remains responsible for OBS WebSocket, telemetry, diagnostics, and cloud publishing.

## Compatibility

The dock API `obs_frontend_add_dock_by_id` was added in OBS Studio 30.0. Use OBS Studio 30 or newer. The initial target is 64-bit Windows.

## Build prerequisites

Building a native OBS plugin requires the matching OBS Studio development CMake packages and Qt 6 development files. An ordinary OBS Studio installation does not include all plugin headers and CMake package files.

- Windows 10/11 x64
- Visual Studio 2022 C++ workload
- CMake 3.24+
- OBS Studio 30+ development SDK/build tree
- Qt 6 Widgets and Network matching the OBS build

Configure this project from a Developer PowerShell/Developer Command Prompt with the OBS CMake package locations available:

```powershell
cmake -S . -B build -A x64
cmake --build build --config RelWithDebInfo
```

The resulting module is `streamify-obs.dll`. It must be installed into OBS's plugin layout alongside the Qt/runtime dependencies required by the exact OBS build. Do not copy an arbitrary DLL into OBS: plugin ABI and Qt versions must match.

## Install location

For a packaged Windows build, the expected OBS plugin layout is:

```text
obs-studio/
  obs-plugins/
    64bit/
      streamify-obs.dll
  data/
    obs-plugins/
      streamify-obs/
```

The release installer/package will handle the exact paths and runtime dependencies. Manual DLL copying is for development only.

## Use

1. Start OBS Studio.
2. Start Streamify Core on the same PC.
3. Confirm Core can connect to OBS WebSocket.
4. In OBS, open **View → Docks → Streamify**.
5. The dock should show Core, OBS, stream, and diagnostics status.

If Core is offline, the dock will tell you to start Streamify Core. It does not attempt to install or start Core automatically.

## Development status

This is the first native dock implementation. A Windows release build and installer still need to be produced and tested against the user's installed OBS version before it is considered install-ready.
