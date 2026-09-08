# রংধনু ক্যাফে এন্ড রেস্টুরেন্ট (Rongdhonu Café & Restaurant)

A complete restaurant management system built with React Native & Expo.

## Features

### 🍽️ Order Management
- Table-based order tracking
- Delivery order support
- Real-time order status updates

### 💰 Financial Management
- Daily sales tracking
- Multiple payment methods (Cash, bKash, Nagad, Rocket)
- Expense management (Suppliers, Market, Others)
- Owner profit calculation
- Daily submit with lock mechanism

### 👥 Multi-Role System
| Role | Access |
|------|--------|
| **Owner** | Full access, finance dashboard, employee management |
| **Admin** | Full access, device control, analytics |
| **Manager** | Orders, expenses, daily submit |

### 📊 Business Analytics
- Daily/Weekly/Monthly comparison
- Sales vs Profit analysis
- Expense breakdown by category
- Weather impact analysis
- Top selling items

### 📱 Device Management
- Device registration & approval
- Remote force logout
- Device blocking/unblocking
- Last seen tracking
- Biometric authentication (Owner/Admin)

### ☁️ Cloud Sync
- Firebase Firestore integration
- Offline-first architecture
- Automatic sync queue
- Delta sync for efficiency

## Tech Stack

- **Framework**: React Native with Expo SDK 56
- **Database**: SQLite (local) + Firebase Firestore (cloud)
- **Language**: JavaScript
- **State Management**: React Hooks

## Getting Started

### Prerequisites
- Node.js 18+
- Expo CLI
- Android Studio (for Android build)

### Installation

```bash
# Clone the repository
git clone https://github.com/rshakib/Ronghonu_App.git

# Install dependencies
npm install

# Copy example env file
cp example.env .env

# Edit .env with your Firebase credentials
nano .env

# Start development server
npx expo start
```

### Build APK

```bash
# Build preview APK
eas build -p android --profile preview
```

## Environment Variables

Copy `example.env` to `.env` and fill in your values:

| Variable | Description |
|----------|-------------|
| `EXPO_PUBLIC_FIREBASE_API_KEY` | Firebase API Key |
| `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN` | Firebase Auth Domain |
| `EXPO_PUBLIC_FIREBASE_PROJECT_ID` | Firebase Project ID |
| `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET` | Firebase Storage Bucket |
| `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Firebase Messaging Sender ID |
| `EXPO_PUBLIC_FIREBASE_APP_ID` | Firebase App ID |

## Project Structure

```
rong/
├── App.js                 # Main application
├── database.js            # SQLite & sync logic
├── screens/               # UI screens
│   ├── ManagerDashboard.js
│   ├── OwnerDashboard.js
│   ├── AdminDB.js
│   └── ...
├── services/              # Business logic
│   ├── deviceRegistry.js
│   ├── analyticsService.js
│   └── analyticsHelper.js
└── assets/                # Images, icons
```

## Default Login Credentials

| Role | Username | PIN |
|------|----------|-----|
| Owner | `ro` | `2420` |
| Manager | `m` | `1111` |
| Admin | `a` | `1323` |

> **Note**: Owner and Admin require biometric authentication after PIN entry.

## License

Private - All rights reserved.

## Developer

**রিয়াজুল হাসান সাকিব** (Riazul Hasan Sakib)

---

Made with ❤️ for রংধনু ক্যাফে এন্ড রেস্টুরেন্ট
