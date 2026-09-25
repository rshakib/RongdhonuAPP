# BACKUP NOTES — Phase 1: Firebase Anonymous Authentication

Created: 2026-09-18 20:52:00 (Local Time)

## 1. Baseline Git State
- **Branch**: `main` (switched to feature branch: `feat/firebase-anonymous-auth-phase1`)
- **Baseline Commit**: `e38b61c3eadd030337980949659d4ffaf58ea1f9`
- **Commit Message**: `Backup: Working tree state before Supabase Device Control migration`
- **Working Tree**: Preserved uncommitted changes across 16 modified files and 7 untracked files.

## 2. Backup Locations (OUTSIDE the Project)
1. **Uncompressed Mirror Directory**:
   `/run/media/shaki/2472D89F72D87750/Apps/rong_backup_phase1_20260918_205200/`
2. **Compressed Tarball**:
   `/run/media/shaki/2472D89F72D87750/Apps/rong_backup_phase1_20260918_205200.tar.gz`
   - Archive SHA256: `2f87237adb88391166c78957bc7018f3c265d833393248d144078490cd245227`

## 3. Preserved Working APK
- **APK Path in Project**: `/run/media/shaki/2472D89F72D87750/Apps/rong/build-1789740786022.apk`
- **APK Path in Backup**: `/run/media/shaki/2472D89F72D87750/Apps/rong_backup_phase1_20260918_205200/build-1789740786022.apk`
- **File Size**: 78 MB
- **APK SHA256 Checksum**:
  `d43cedc8e441af60afdca0c1a5b6f84277d7d38e1441fe57854ae5cf59d69541`

## 4. Exact Rollback Instructions
To restore the project to the exact state before any changes were made:
```bash
# Option A: Fast restore from uncompressed mirror
rsync -av --delete --exclude=node_modules --exclude=.git --exclude=.expo \
  /run/media/shaki/2472D89F72D87750/Apps/rong_backup_phase1_20260918_205200/ \
  /run/media/shaki/2472D89F72D87750/Apps/rong/

# Option B: Restore from compressed tarball
tar -xzf /run/media/shaki/2472D89F72D87750/Apps/rong_backup_phase1_20260918_205200.tar.gz \
  -C /run/media/shaki/2472D89F72D87750/Apps/rong/

# Switch back to main branch
git checkout main
```

To reinstall the preserved working APK on a connected Android device:
```bash
adb install -r /run/media/shaki/2472D89F72D87750/Apps/rong_backup_phase1_20260918_205200/build-1789740786022.apk
```
