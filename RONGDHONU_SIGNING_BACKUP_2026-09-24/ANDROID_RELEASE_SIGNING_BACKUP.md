# Android Release Signing — Complete Backup & Recovery Guide

**Backup Date:** 2026-09-24
**Prepared while authenticated as:** `shakib223` (rshakib223594@bscse.uiu.ac.bd)
**Original EAS Account:** `shakib223`
**Original EAS Project Name:** `@shakib223/temp-expo`
**Original EAS Project ID:** `5bbb3050-c514-4ce8-88f4-655a9cec68ba`

> [!IMPORTANT]
> All three keystore binaries were exported from the original EAS project, saved locally, and fingerprint-verified against the expected SHA-1 and SHA-256 values. All verification results: **MATCH**. No new keys were generated.

---

## 1. Application & Signing Identity Matrix

| App | Package / Application ID | Local Keystore File | Key Alias | Cert SHA-1 | Cert SHA-256 |
|---|---|---|---|---|---|
| **Admin** | `com.riajulshakib.rongdhonu` | `credentials/android/keystore.jks` | `c01b3d404d4cc385538488630b03dd7c` | `E0:35:34:9A:54:A9:88:31:54:36:9A:A3:C0:04:73:3A:74:57:4C:67` | `E8:EB:18:51:41:88:81:F0:C3:5B:12:F0:8B:29:1B:6F:15:BC:92:B4:A7:2A:43:50:BB:57:A6:05:54:34:CA:F1` |
| **Owner** | `com.riajulshakib.rongdhonu.owner` | `credentials/android/owner_keystore.jks` | `7e141638731f7f36e4ddef2160a45ae5` | `CD:D7:28:71:F6:D7:F9:1C:68:0B:C0:D1:31:59:96:C4:D2:A4:5A:C3` | `34:1A:5F:55:C5:2B:A7:B6:E9:D2:97:BC:20:03:94:49:B0:E9:8C:AC:39:33:43:54:38:C6:33:2C:B7:FF:13:9D` |
| **Manager** | `com.riajulshakib.rongdhonu.manager` | `credentials/android/manager_keystore.jks` | `d7f4e022e58934bfa76736d16fdbe33d` | `8A:9C:9A:1F:A2:30:F5:DE:4C:A7:4F:AE:4C:6A:6F:E3:04:AB:13:9B` | `A1:47:2D:D0:EE:95:83:E0:89:37:A3:8E:32:D2:D5:9B:60:5E:DF:98:E7:4C:4E:6F:C1:61:3E:CE:50:48:A5:DE` |

---

## 2. Credential Configuration Files

| App | Credential File | EAS Build Profile | credentialsSource |
|---|---|---|---|
| **Admin** | `credentials/android/credentials.admin.json` | `admin` | `local` |
| **Owner** | `credentials/android/credentials.owner.json` | `owner` | `local` |
| **Manager** | `credentials/android/credentials.manager.json` | `manager` | `local` |

### How the credential switcher works

The root `credentials.json` is dynamically written before each build:

```bash
node scripts/select-credentials.js admin    # copies credentials.admin.json → credentials.json
node scripts/select-credentials.js owner    # copies credentials.owner.json → credentials.json
node scripts/select-credentials.js manager  # copies credentials.manager.json → credentials.json
```

npm shortcuts:

```bash
npm run build:admin:local     # select admin + eas build admin
npm run build:owner:local     # select owner + eas build owner
npm run build:manager:local   # select manager + eas build manager
```

`app.config.js` also reads `EXPO_PUBLIC_APP_PROFILE` at build time and auto-syncs `credentials.json` to the matching profile credential file.

---

## 3. Required Local Files for Future Release Builds

> [!CAUTION]
> None of the following files are in git. If lost, builds will fail. Keep a secure encrypted offline backup of the entire `credentials/android/` directory.

```
credentials/android/keystore.jks              ← Admin release keystore
credentials/android/owner_keystore.jks        ← Owner release keystore
credentials/android/manager_keystore.jks      ← Manager release keystore
credentials/android/credentials.admin.json    ← Admin keystore path + alias + passwords
credentials/android/credentials.owner.json    ← Owner keystore path + alias + passwords
credentials/android/credentials.manager.json  ← Manager keystore path + alias + passwords
credentials.json                              ← Active-profile credential (set by switcher)
```

Files committed to git (build system, no secrets):

```
eas.json                        ← credentialsSource: "local" for all three profiles
app.config.js                   ← Profile-based package IDs + credential sync
package.json                    ← npm build scripts with credential pre-selector
scripts/select-credentials.js   ← Credential switcher
scripts/fetch-original-passwords.js  ← Recovery tool (requires shakib223 EAS access)
```

---

## 4. Secret Storage

Keystore passwords (keystorePassword, keyPassword) are stored **only** in:

- `credentials/android/credentials.admin.json`
- `credentials/android/credentials.owner.json`
- `credentials/android/credentials.manager.json`

These files are git-ignored. Passwords are **NOT** printed in this document or anywhere in git.

For offsite backup, copy the entire `credentials/android/` directory to an encrypted medium.

---

## 5. EAS Project Information

| Field | Value |
|---|---|
| Original EAS Account | `shakib223` |
| Original EAS Project Name | `@shakib223/temp-expo` |
| Original EAS Project ID | `5bbb3050-c514-4ce8-88f4-655a9cec68ba` |
| Current Working EAS Account | `riajulshakib` |
| Current EAS Project ID (OTA) | `c0ef37bc-f64e-4a5d-8f68-8296556b722a` |

Local builds (`eas build --local`) do **not** require EAS server access. They read signing credentials entirely from the local JSON files.

---

## 6. How to Perform a Future Local Release Build

```bash
# Admin
npm run build:admin:local

# Owner
npm run build:owner:local

# Manager
npm run build:manager:local
```

### Verify APK signer after build

```bash
apksigner verify --print-certs Admin.apk   | grep -E "SHA-1|SHA-256"
apksigner verify --print-certs Owner.apk   | grep -E "SHA-1|SHA-256"
apksigner verify --print-certs Manager.apk | grep -E "SHA-1|SHA-256"
```

Match expected SHA-1 values in Section 1.

---

## 7. Switching EAS Accounts

Local builds are independent of EAS cloud credentials. Switching accounts only affects cloud builds and OTA publishing.

```bash
npx eas logout
npx eas login   # enter desired account
```

---

## 8. Recovery Instructions

### Scenario: Credential files lost, shakib223 account still accessible

```bash
npx eas logout && npx eas login   # login as shakib223
node scripts/fetch-original-passwords.js
npx eas logout && npx eas login   # login back as riajulshakib
```

`fetch-original-passwords.js` reconnects to EAS project `5bbb3050-c514-4ce8-88f4-655a9cec68ba` and recreates `credentials.owner.json` and `credentials.manager.json`.

### Scenario: shakib223 EAS account inaccessible, local .jks files still exist

The `.jks` files and credential JSON files are all that is needed. EAS account access is not required for local signing. Recreate the JSON files manually using the alias values from Section 1.

### Scenario: Both EAS account and local .jks files lost

Signing keys are **permanently and irrecoverably lost**. Existing installed apps cannot receive seamless updates — users must uninstall and reinstall.

### Scenario: APK install fails with "Conflicting app signatures" (error -7)

1. Confirm which credential was active during the build (`credentials.json` content).
2. Check APK signer with `apksigner verify --print-certs`.
3. Match against expected SHA-1 in Section 1.
4. Rebuild with `node scripts/select-credentials.js <profile>` first.

---

## 9. Git Security Audit

Patterns confirmed git-ignored:

```
*.jks
*.keystore
credentials.json
credentials.*.json
credentials/**/*.jks
credentials/**/*.json
```

No credential file has been committed to the repository.

---

## 10. Fingerprint Verification Log (2026-09-24)

Exported from EAS project `5bbb3050-c514-4ce8-88f4-655a9cec68ba` while authenticated as `shakib223`. Verified with `keytool -list -v`.

| App | JKS File | SHA-1 | SHA-256 |
|---|---|---|---|
| Admin | `credentials/android/keystore.jks` | ✅ MATCH | ✅ MATCH |
| Owner | `credentials/android/owner_keystore.jks` | ✅ MATCH | ✅ MATCH |
| Manager | `credentials/android/manager_keystore.jks` | ✅ MATCH | ✅ MATCH |
