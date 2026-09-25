# Android Signing Conflict Incident, Diagnosis & Recovery Guide

This document is a technical guide and permanent troubleshooting reference for resolving Android signature conflicts (`INSTALL_FAILED_UPDATE_INCOMPATIBLE` / error `-7`) across the Rongdhonu multi-app ecosystem.

---

## 1. Incident Summary

### The Error
When updating an already installed app on a physical Android device, installation fails with:
```text
INSTALL_FAILED_UPDATE_INCOMPATIBLE (-7)
```
**User-Visible Message:**
> *"Couldn't install (-7) Conflicting app signatures"*

### Technical Root Cause
Android's Package Manager enforces cryptographic integrity for all package updates:
1. Android uniquely identifies an installed application by its **Application ID (Package Name)** (e.g., `com.riajulshakib.rongdhonu.owner`).
2. When an update APK with the same package name is presented (`adb install -r` or manual file manager install), Android checks whether the certificate signing the incoming APK matches the certificate of the currently installed APK.
3. If the certificate fingerprints differ:
   $$\text{Same Package Name} + \text{Different Signing Key} = \text{INSTALL\_FAILED\_UPDATE\_INCOMPATIBLE (-7)}$$

### Why Uninstalling Is NOT The Correct Solution
Uninstalling the app removes the signature conflict because Android forgets the old certificate. **However, uninstalling immediately wipes all local app data**, including:
- Un-synced offline SQLite database transactions.
- Local printer and peripheral pairings.
- Cached authentication state and offline device tokens.

**The only correct solution** is to build the update APK using the **exact original signing key** that signed the installed application.

---

## 2. What Caused Our Specific Problem

### The Incident
During a release build for the **Owner app**, Android rejected the APK update with error `-7`.

- **Target App:** রংধনু ওনার (Owner Dashboard)
- **Package Name:** `com.riajulshakib.rongdhonu.owner`
- **Installed App Signer (Original Key):**
  - SHA-1: `CD:D7:28:71:F6:D7:F9:1C:68:0B:C0:D1:31:59:96:C4:D2:A4:5A:C3`
- **Conflict Signer (New EAS Cloud Key):**
  - SHA-1: `C8:57:FD:EB:75:A4:09:31:0C:A0:A8:07:13:92:53:77:82:44:5D:C1`

### Root Cause Analysis
1. A new EAS project / account (`riajulshakib`) was initialized.
2. When Owner was built through the new project without pinning local credentials, EAS automatically signed the build using its newly generated cloud key (`C8:57:FD...`).
3. When the user attempted to install this APK over the existing installed Owner app (signed with `CD:D7:28...`), Android rejected the installation due to signature mismatch.
4. Furthermore, attempting to sign Owner with the Admin/Manager key (`E0:35:34...`) also failed because each of the three applications was originally signed with its own dedicated key.

---

## 3. Original Signing Identity Matrix

The three Rongdhonu applications have distinct package names and distinct original release signing keys. **Never substitute one app's keystore for another.**

| Application | Package / Application ID | Keystore File Path | Key Alias | Certificate SHA-1 | Certificate SHA-256 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Admin** | `com.riajulshakib.rongdhonu` | `credentials/android/keystore.jks` | `c01b3d404d4cc385538488630b03dd7c` | `E0:35:34:9A:54:A9:88:31:54:36:9A:A3:C0:04:73:3A:74:57:4C:67` | `E8:EB:18:51:41:88:81:F0:C3:5B:12:F0:8B:29:1B:6F:15:BC:92:B4:A7:2A:43:50:BB:57:A6:05:54:34:CA:F1` |
| **Owner** | `com.riajulshakib.rongdhonu.owner` | `credentials/android/owner_keystore.jks` | `7e141638731f7f36e4ddef2160a45ae5` | `CD:D7:28:71:F6:D7:F9:1C:68:0B:C0:D1:31:59:96:C4:D2:A4:5A:C3` | `34:1A:5F:55:C5:2B:A7:B6:E9:D2:97:BC:20:03:94:49:B0:E9:8C:AC:39:33:43:54:38:C6:33:2C:B7:FF:13:9D` |
| **Manager** | `com.riajulshakib.rongdhonu.manager` | `credentials/android/manager_keystore.jks` | `d7f4e022e58934bfa76736d16fdbe33d` | `8A:9C:9A:1F:A2:30:F5:DE:4C:A7:4F:AE:4C:6A:6F:E3:04:AB:13:9B` | `A1:47:2D:D0:EE:95:83:E0:89:37:A3:8E:32:D2:D5:9B:60:5E:DF:98:E7:4C:4E:6F:C1:61:3E:CE:50:48:A5:DE` |

---

## 4. Original EAS Project Information

All three original release signing keys were generated and managed under the original EAS project:

- **Original EAS Account:** `shakib223` (`rshakib223594@bscse.uiu.ac.bd`)
- **Original EAS Project:** `@shakib223/temp-expo`
- **Original EAS Project ID:** `5bbb3050-c514-4ce8-88f4-655a9cec68ba`

All keystores, aliases, and credentials were authenticated, retrieved, and verified directly from this project. The project is now configured so that local builds (`eas build --local`) consume the original keys directly from the local disk without relying on EAS cloud credentials.

---

## 5. Current Local Signing Setup

To decouple local builds from EAS account migrations, all signing keys are stored locally and referenced per profile.

### Keystores
- Admin: `credentials/android/keystore.jks`
- Owner: `credentials/android/owner_keystore.jks`
- Manager: `credentials/android/manager_keystore.jks`

### Build Profiles (`eas.json`)
Each release profile specifies `"credentialsSource": "local"`:
- `admin` profile → uses Admin original keystore
- `owner` profile → uses Owner original keystore
- `manager` profile → uses Manager original keystore

### Local Credential Files
Dedicated, git-ignored configuration files map passwords and aliases locally:
- `credentials/android/credentials.admin.json`
- `credentials/android/credentials.owner.json`
- `credentials/android/credentials.manager.json`

### Credential Switcher (`scripts/select-credentials.js`)
EAS CLI expects a single `./credentials.json` file in the workspace root. Before each local build, `scripts/select-credentials.js` activates the corresponding per-profile credential file:
```bash
npm run build:admin:local    # selects admin credentials -> builds Admin.apk
npm run build:owner:local    # selects owner credentials -> builds Owner.apk
npm run build:manager:local  # selects manager credentials -> builds Manager.apk
```

---

## 6. Backup Locations

### 1. Working Keystores (In Repository Directory)
Path: `credentials/android/`
Protected by `.gitignore`. Contains the three working `.jks` files and their profile JSON configuration files.

### 2. Standalone Physical Backup (Outside Repository)
**Exact Path:**
```text
/run/media/shaki/2472D89F72D87750/Apps/RONGDHONU_SIGNING_BACKUP_2026-09-24/
```

**Directory Structure:**
```text
RONGDHONU_SIGNING_BACKUP_2026-09-24/
├── README.txt
├── ANDROID_RELEASE_SIGNING_BACKUP.md
├── admin/
│   └── keystore.jks
├── owner/
│   └── owner_keystore.jks
└── manager/
    └── manager_keystore.jks
```

*Note: All backup keystores are verified byte-for-byte identical to the working originals with matching SHA-1 and SHA-256 fingerprints.*

---

## 7. How to Diagnose the Error in the Future

Follow this step-by-step diagnostic process whenever an install error occurs:

### Step 1: Identify the Installed Package Name
Determine which package is installed on the device:
```bash
adb shell pm list packages | grep rongdhonu
```

### Step 2: Inspect Installed App Signing Certificate
Dump the certificate SHA-1 of the app currently installed on the phone:
```bash
# Example for Owner:
adb shell pm path com.riajulshakib.rongdhonu.owner
# Pull the APK and inspect:
adb pull <path-from-above> installed_owner.apk
apksigner verify --print-certs installed_owner.apk | grep -E "SHA-1|SHA-256"
```

### Step 3: Inspect the Newly Built APK Signing Certificate
Check the fingerprint of the APK you just compiled:
```bash
apksigner verify --print-certs Owner.apk | grep -E "SHA-1|SHA-256"
```

### Step 4: Compare SHA-1 Fingerprints
- **If SHA-1 fingerprints match:** The certificate is compatible. Any remaining install issue is likely due to `versionCode` (e.g., trying to downgrade a higher `versionCode`).
- **If SHA-1 fingerprints differ:** **DO NOT INSTALL.** The build used the wrong key. Proceed to Section 8 to fix the signing configuration.

---

## 8. How to Fix the Problem

1. **Owner App:**
   - Must be signed with `credentials/android/owner_keystore.jks` (Alias: `7e141638731f7f36e4ddef2160a45ae5`).
   - Run `node scripts/select-credentials.js owner` before building.
2. **Manager App:**
   - Must be signed with `credentials/android/manager_keystore.jks` (Alias: `d7f4e022e58934bfa76736d16fdbe33d`).
   - Run `node scripts/select-credentials.js manager` before building.
3. **Admin App:**
   - Must be signed with `credentials/android/keystore.jks` (Alias: `c01b3d404d4cc385538488630b03dd7c`).
   - Run `node scripts/select-credentials.js admin` before building.

**Golden Rules:**
- Never substitute another app's keystore.
- Never generate a replacement key for an existing production package.
- Always use the dedicated npm script: `npm run build:<profile>:local`.

---

## 9. Future Build Safety Checklist

Complete this checklist prior to building and distributing any release APK:

- [ ] Correct build profile selected (`admin`, `owner`, or `manager`).
- [ ] Correct package ID verified in `app.config.js`.
- [ ] Correct local keystore file verified on disk.
- [ ] Correct alias verified.
- [ ] `eas.json` specifies `credentialsSource: "local"` for the target profile.
- [ ] Correct credential JSON activated in root `credentials.json`.
- [ ] `versionCode` in `app.json` / `app.config.js` is strictly greater than the installed version.
- [ ] APK signer verified post-build with `apksigner verify --print-certs <app>.apk`.
- [ ] APK package name verified post-build with `aapt dump badging <app>.apk`.
- [ ] Existing app on device is NOT uninstalled.

---

## 10. Common Mistakes to Avoid

1. **Using Admin Keystore for Owner or Manager:** Admin, Owner, and Manager each have their own original keys. They are not interchangeable.
2. **Generating a New Keystore:** Generating a new key will permanently break update compatibility with installed production devices.
3. **Falling Back to EAS Cloud Signing:** If `credentialsSource` is set to `"remote"`, EAS CLI will pull cloud credentials from the active EAS account instead of using the local original key.
4. **Building with the Wrong Profile:** Running `eas build --profile admin` while attempting to update Owner will create a package mismatch.
5. **Uninstalling Production App to Bypass Conflict:** This destroys offline database records and un-synced orders.
6. **Committing Credentials to Git:** Never commit `.jks`, `.keystore`, or `credentials*.json` files.
7. **Installing Without Inspecting:** Always verify `apksigner` output before deploying to users.

---

## 11. Emergency Recovery Procedures

### If a Signature Conflict Occurs:
1. **STOP** immediately. Do not attempt to force install or uninstall the existing app.
2. Run `apksigner verify --print-certs` on both the installed APK and the new APK.
3. Check Section 3 of this document to confirm which key was supposed to be used.
4. Run `node scripts/select-credentials.js <profile>` to re-align `credentials.json`.
5. Rebuild the APK locally with `npm run build:<profile>:local`.
6. Verify the new APK fingerprint before distributing.

### If a Working Keystore in `credentials/android/` Is Lost:
Restore the byte-for-byte original copy from the physical backup directory:
```bash
cp /run/media/shaki/2472D89F72D87750/Apps/RONGDHONU_SIGNING_BACKUP_2026-09-24/admin/keystore.jks credentials/android/
cp /run/media/shaki/2472D89F72D87750/Apps/RONGDHONU_SIGNING_BACKUP_2026-09-24/owner/owner_keystore.jks credentials/android/
cp /run/media/shaki/2472D89F72D87750/Apps/RONGDHONU_SIGNING_BACKUP_2026-09-24/manager/manager_keystore.jks credentials/android/
```

### If Both Working and Backup Directories Are Lost:
Log into the original EAS account:
```bash
npx eas logout && npx eas login  # Use shakib223 credentials
node scripts/fetch-original-passwords.js
```
This queries original EAS Project ID `5bbb3050-c514-4ce8-88f4-655a9cec68ba` and restores the credentials.

---

## 12. Security Guidelines

- Keystore files (`.jks`) and credential files (`credentials*.json`) contain sensitive cryptographic keys and cleartext passwords.
- Ensure `.gitignore` continues to ignore:
  ```gitignore
  *.jks
  *.keystore
  credentials.json
  credentials.*.json
  credentials/**/*.jks
  credentials/**/*.json
  ```
- **Never paste passwords, private keys, or EAS authentication tokens into Markdown files or commit messages.**
- Maintain an encrypted offline backup copy of `RONGDHONU_SIGNING_BACKUP_2026-09-24/` in a secure location.
