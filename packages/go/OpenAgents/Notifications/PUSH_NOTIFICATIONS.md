# iOS push notifications — what we learned the hard way

The short version: **never link `FirebaseAuth` via SPM in an app that also uses
APNs directly**. Even if your code never imports it, just adding the product
to the iOS target silently swallows `didRegisterForRemoteNotifications…`
callbacks. The symptom is APNs registration that appears to succeed on the
device (the OS prompt fires, permission shows ON in Settings) but never
yields a token — no success callback, no failure callback, no log.

Upstream issue: <https://github.com/firebase/firebase-ios-sdk/issues/14751>.
Workaround (the only one): remove the `FirebaseAuth` product from SPM
dependencies, clean derived data, rebuild.

## Why this bit us

`AuthStore` originally used `FirebaseAuth.Auth.signIn(with:…)` for Google
sign-in on macOS — but on iOS that triggered an amfid `-413` rejection of
the `keychain-access-groups` entitlement on Developer ID builds. We dropped
the Firebase Auth code and switched to `GIDSignIn` (the standalone Google
SDK), but **left `FirebaseAuth` in the Xcode target's SPM products list**
because we were still calling `FirebaseApp.app()?.options.clientID` to read
the OAuth client ID from `GoogleService-Info.plist`. `FirebaseCore` alone
is enough for that — the `FirebaseAuth` product was dead weight that
happened to break APNs.

## How to confirm this is the bug you're hitting

1. Notification permission shows granted in iOS Settings → your app →
   Notifications.
2. `application.registerForRemoteNotifications()` is called.
3. Neither `didRegisterForRemoteNotificationsWithDeviceToken` nor
   `didFailToRegisterForRemoteNotificationsWithError` ever fires (silent).
4. `UserDefaults["pushSink.lastAPNsToken"]` stays empty across launches.
5. `grep -rn "FirebaseAuth" .xcodeproj/project.pbxproj` returns matches.

If all five are true, this is the bug. Remove `FirebaseAuth` from the
target's frameworks and SPM dependency list, clean, rebuild.

## Distribution / entitlement matrix (also caught us mid-debug)

These must line up — a mismatch causes silent registration failure too, so
strip out the FirebaseAuth issue first by removing it, *then* check this:

| Install path | Signing cert | `aps-environment` | Backend `APNS_ENVIRONMENT` |
|---|---|---|---|
| Xcode → Run with cable | Apple Development | `development` | `sandbox` |
| Archive → Distribute → Development (sideload IPA) | Apple Development | `development` | `sandbox` |
| Archive → Distribute → TestFlight / App Store | Apple Distribution | `production` | `production` |

A single `.p8` auth key with "Sandbox & Production" scope works for both
backend environments — only the host (`api.sandbox.push.apple.com` vs
`api.push.apple.com`) differs, and `aioapns` selects it based on
`APNS_ENVIRONMENT`.

## Useful backend debug knobs (kept around)

- `workspace/backend/app/main.py` has a `RequestValidationError` handler
  that logs the offending body on every 422 — invaluable when chasing a
  client/server schema drift on `POST /v1/devices/register`.
- Same file has a `UserAgentLogMiddleware` that logs UA on every POST so
  you can tell `OpenAgents Go/<build>` (iOS URLSession) apart from a
  Chrome web client when both are hammering the same workspace.

## When sign-in changes, re-register

`AuthStore.apply(googleUser:)` and `AuthStore.signOut()` now call
`PushSink.shared.reregisterAfterAuthChange()` — that re-fires
`POST /v1/devices/register` for every workspace in history using the
cached APNs token and the new email. Without this, a device registered
before sign-in had `device_tokens.user_email = NULL` forever, and mention
pushes never resolved to that user's devices.
