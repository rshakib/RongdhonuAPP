# রংধনু ক্যাফে এন্ড রেস্টুরেন্ট (Rongdhonu Café & Restaurant)

An **offline-first** restaurant management system built with **React Native 0.85.3 + Expo SDK 56 (JavaScript)**.
One codebase builds **three Android apps** (Admin / Owner / Manager) selected at build time.

> **Working on this repo?** Read **[AGENTS.md](./AGENTS.md)** first — full setup, architecture,
> sync design, invariants, diagnostics and recipes. `website.md` holds the parked online-ordering plan.

## Apps (one codebase, three builds)

| Profile | App | Android package | Build script |
|---|---|---|---|
| `ADMIN` | রংধনু এডমিন | `com.riajulshakib.rongdhonu` | `npm run build:admin:local` |
| `OWNER` | রংধনু ওনার | `com.riajulshakib.rongdhonu.owner` | `npm run build:owner:local` |
| `MANAGER` | রংধনু ম্যানেজার | `com.riajulshakib.rongdhonu.manager` | `npm run build:manager:local` |

Current version: **1.0.10** (Android **versionCode 13**) — source of truth is `app.json`.

## Features

### 🍽️ Order Management
- Table-based order tracking (`table_1` … `table_8`) plus delivery orders
- **Extras / add-ons** — menu-driven, rendered nested under their parent item on screen and on the receipt
- **Service charge** — variable per order, shown as its own receipt line before সর্বমোট
- Real-time order status updates

### 💰 Financial Management
- Daily sales tracking with Cash / bKash / Nagad / Rocket splits
- Expense management (suppliers, market, others) + supplier due ledger
- Owner finance: deposits, home deposits, expenses, employee salaries
- Daily submit with lock mechanism

### 👥 Multi-Role System
| Role | Access |
|------|--------|
| **Owner** | Full access, finance dashboard, employee management |
| **Admin** | Full access, device control, analytics, sync diagnostics |
| **Manager** | Orders, expenses, daily submit |
| **Waiter** | Order taking |

### 📊 Business Analytics
- Daily/Weekly/Monthly comparison
- Sales vs Profit analysis
- Expense breakdown by category
- Weather impact analysis
- Top selling items

### 📱 Device Management (Supabase)
- Device registration & approval, remote force logout, blocking/unblocking
- Last-seen tracking, app-usage telemetry, presence + command channel
- Server-side **row-level security per device**; `allow_offline` is admin-authoritative

### ☁️ Cloud Sync
- **Offline-first**: local SQLite is the source of truth at runtime
- **Dual write** — Firebase Firestore (raw REST, no SDK) **and** Supabase
- **Supabase-primary reads**; Firebase is read only by explicit manual actions
- Delta sync with cursors, delete tombstones, retry/backoff queues, sync heartbeat
- Separate **isolated Supabase project** for the audit/activity stream

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React Native 0.85.3 + Expo SDK 56 (JavaScript) |
| Local DB | `expo-sqlite` (`rongdhonu.db`) |
| Cloud A (POS data) | Firebase Firestore REST v1 + anonymous auth (no Firebase SDK) |
| Cloud B (device control) | Supabase (`@supabase/supabase-js` v2) — PostgREST + Realtime |
| Cloud C (audit) | separate Supabase project (activity stream) |
| Printer | `react-native-thermal-printer-driver` (receipt printed as a raster) |
| PDF | `expo-print` + `expo-sharing` |
| State | React hooks (no Redux, no navigation library) |
| Build | EAS Build (`eas.json`), local `eas build --local` |

## Getting Started

### Prerequisites
- Node.js 18+ / 22
- JDK **17**
- Android SDK + `adb` (for local builds), `eas-cli`

### Installation

```bash
# Clone the repository
git clone https://github.com/rshakib/RongdhonuAPP.git
cd rong

# Install dependencies
npm install

# Copy example env file
cp example.env .env

# Edit .env with your Firebase + Supabase credentials
nano .env

# Start development server
npx expo start
```

### Build APK (local)

```bash
export ANDROID_HOME="$HOME/Android/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"

npm run build:admin:local     # -> Admin.apk
npm run build:owner:local     # -> Owner.apk
npm run build:manager:local   # -> Manager.apk
```

`eas.json` already carries the per-profile `EXPO_PUBLIC_*` values (Firebase, Supabase, audit) and the
per-profile credential file is selected automatically before each build.
Cloud build without a local SDK: `eas login && eas build -p android --profile <profile>`.

## Environment Variables

Copy `example.env` to `.env` and fill in your values (all are inlined at build time):

| Variable | Description |
|----------|-------------|
| `EXPO_PUBLIC_APP_PROFILE` | `ADMIN` / `OWNER` / `MANAGER` build profile |
| `EXPO_PUBLIC_FIREBASE_API_KEY` | Firebase API Key |
| `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN` | Firebase Auth Domain |
| `EXPO_PUBLIC_FIREBASE_PROJECT_ID` | Firebase Project ID |
| `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET` | Firebase Storage Bucket |
| `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Firebase Messaging Sender ID |
| `EXPO_PUBLIC_FIREBASE_APP_ID` | Firebase App ID |
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL (device control + primary read) |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `EXPO_PUBLIC_SUPABASE_SYNC_ENABLED` | Kill switch for dual-write + Supabase pull |
| `EXPO_PUBLIC_REALTIME_SIGNAL_ENABLED` | Realtime change signal / adaptive polling |
| `EXPO_PUBLIC_AUDIT_SUPABASE_URL` / `_ANON_KEY` | Isolated audit Supabase project |
| `EXPO_PUBLIC_AUDIT_SYNC_ENABLED` | Audit stream on/off |
| `EXPO_PUBLIC_AI_DATASET_ENABLED` | AI dataset export flag (default `false`) |

## Project Structure

```
rong/
├── App.js                 # Root component: string router + app state + sync orchestration
├── database.js            # SQLite schema + data/sync functions
├── app.json / app.config.js / eas.json   # Expo + build/per-profile config
├── pdfHelper.js           # PDF report generation
├── screens/               # UI screens (dashboards, POS, finance, diagnostics)
├── components/            # Shared UI (side menus, modals, ReceiptPaper, pickers)
├── services/              # Sync, device control, printer, audit, analytics
│   ├── supabase*.js       # Supabase client / pull engine / dual-write queue / device control
│   ├── firebase*.js       # Firestore REST auth, app-config, day restore
│   └── printer/           # Native thermal printer pipeline
├── supabase_*.sql         # Server schema / RLS / cron / audit setup
├── docs/                  # Signing + feature docs
├── tests/                 # Node test scripts (local only)
└── assets/ image/         # Icons, splash, fonts, logos
```

## Tests

```bash
npm run test:all        # 72 plain-node test scripts
```
The suite does not parse JSX — Babel-parse any edited screen/component before committing
(see [AGENTS.md](./AGENTS.md) §14).

## License

Private - All rights reserved.

## Developer

**রিয়াজুল হাসান সাকিব** (Riajul Hasan Shakib)

---

Made with ❤️ for রংধনু ক্যাফে এন্ড রেস্টুরেন্ট
