# Android Release Signing Keys Backup & Documentation

**Backup Date:** 2026-09-24  
**Original EAS Account:** `shakib223`  
**Original EAS Project Name:** `temp-expo`  
**Original EAS Project ID:** `5bbb3050-c514-4ce8-88f4-655a9cec68ba`  

---

## 1. Overview & Purpose

This repository powers three dedicated applications for the Rongdhonu POS system:
1. **Admin App** (`com.riajulshakib.rongdhonu`)
2. **Owner App** (`com.riajulshakib.rongdhonu.owner`)
3. **Manager App** (`com.riajulshakib.rongdhonu.manager`)

Each application has its own distinct Android package name and application ID. Because existing production installations already exist on physical Android devices, Android's Package Manager cryptographically verifies that any update (`adb install -r` or manual APK install) must be signed with the **exact same signing certificate** that signed the installed version.

If an APK is signed with a different key, Android terminates installation with error code `-7` (`INSTALL_FAILED_UPDATE_INCOMPATIBLE` / *Conflicting app signatures*).

To preserve seamless in-place updates without requiring users to uninstall their apps or risk local data loss, the original release signing keys for all apps have been secured and verified locally.

---

## 2. Signing Key Matrix

| Application | Package / Application ID | Local Keystore File Path | Key Alias | Certificate SHA-1 | Certificate SHA-256 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Owner** | `com.riajulshakib.rongdhonu.owner` | `credentials/android/owner_keystore.jks` | `7e141638731f7f36e4ddef2160a45ae5` | `CD:D7:28:71:F6:D7:F9:1C:68:0B:C0:D1:31:59:96:C4:D2:A4:5A:C3` | `34:1A:5F:55:C5:2B:A7:B6:E9:D2:97:BC:20:03:94:49:B0:E9:8C:AC:39:33:43:54:38:C6:33:2C:B7:FF:13:9D` |
| **Manager** | `com.riajulshakib.rongdhonu.manager` | `credentials/android/manager_keystore.jks` | `d7f4e022e58934bfa76736d16fdbe33d` | `8A:9C:9A:1F:A2:30:F5:DE:4C:A7:4F:AE:4C:6A:6F:E3:04:AB:13:9B` | `A1:47:2D:D0:EE:95:83:E0:89:37:A3:8E:32:D2:D5:9B:60:5E:DF:98:E7:4C:4E:6F:C1:61:3E:CE:50:48:A5:DE` |
| **Admin** | `com.riajulshakib.rongdhonu` | `credentials/android/keystore.jks` | `c01b3d404d4cc385538488630b03dd7c` | `E0:35:34:9A:54:A9:88:31:54:36:9A:A3:C0:04:73:3A:74:57:4C:67` | `E8:EB:18:51:41:88:81:F0:C3:5B:12:F0:8B:29:1B:6F:15:BC:92:B4:A7:2A:43:50:BB:57:A6:05:54:34:CA:F1` |

---

## 3. Local Keystore Locations & Ownership

All keystore files reside in the local directory:
`credentials/android/`

1. **Owner Release Key:**
   * **Path:** `credentials/android/owner_keystore.jks`
   * **Assigned App:** রংধনু ওনার (Owner Dashboard)
   * **Update Target:** Matches the currently installed Owner app on the device.

2. **Manager Release Key:**
   * **Path:** `credentials/android/manager_keystore.jks`
   * **Assigned App:** রংধনু ম্যানেজার (Manager Dashboard)
   * **Update Target:** Preserves original cloud-built Manager update compatibility.

3. **Admin Release Key:**
   * **Path:** `credentials/android/keystore.jks`
   * **Assigned App:** রংধনু এডমিন (Admin Dashboard / POS)
   * **Update Target:** Preserves existing Admin production update compatibility.

---

## 4. Critical Security Warnings & Rules

> [!CAUTION]
> **NEVER COMMIT KEYSTORES OR PASSWORDS TO GIT**
> Keystore binary files (`*.jks`, `*.keystore`) and configuration files containing cleartext passwords (`credentials.json`) must NEVER be committed to Git or pushed to any public or private repository.
> Verify that `.gitignore` strictly ignores:
> * `*.jks`
> * `credentials/android/*.jks`
> * `credentials/**/*.jks`
> * `credentials.json`

> [!WARNING]
> **REQUIRED FOR IN-PLACE UPDATES**
> If any of these `.jks` files are lost or replaced with newly generated keys, future APK updates will fail with signature conflict error `-7`. Users would be forced to uninstall their application, resulting in potential loss of un-synced offline local SQLite records. Keep a secure, encrypted offline copy of these keystores in a safe backup location.

