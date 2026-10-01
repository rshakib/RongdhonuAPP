const fs = require('fs');
const path = require('path');

module.exports = ({ config }) => {
  const rawProfile = process.env.EXPO_PUBLIC_APP_PROFILE || 'ADMIN';
  const profile = String(rawProfile).toUpperCase().trim();

  const VALID_PROFILES = ['ADMIN', 'OWNER', 'MANAGER'];
  if (!VALID_PROFILES.includes(profile)) {
    throw new Error(
      `[Build Configuration Error] Invalid EXPO_PUBLIC_APP_PROFILE value '${rawProfile}'. ` +
      `Supported profiles are: ${VALID_PROFILES.join(', ')}.`
    );
  }

  // Profile-specific metadata configurations
  // NOTE: slug MUST match the registered Expo server slug ('temp-expo') linked to extra.eas.projectId ('c0ef37bc-f64e-4a5d-8f68-8296556b722a').
  // NOTE: ADMIN profile MUST preserve original package name 'com.riajulshakib.rongdhonu' so existing production installs update seamlessly.
  const PROFILE_CONFIGS = {
    ADMIN: {
      name: 'রংধনু এডমিন',
      slug: 'temp-expo',
      package: 'com.riajulshakib.rongdhonu',
      bundleIdentifier: 'com.riajulshakib.rongdhonu',
      channel: 'admin',
      icon: './assets/icons/admin_icon.png',
      splash: './assets/splash/admin_splash.png'
    },
    OWNER: {
      name: 'রংধনু ওনার',
      slug: 'temp-expo',
      package: 'com.riajulshakib.rongdhonu.owner',
      bundleIdentifier: 'com.riajulshakib.rongdhonu.owner',
      channel: 'owner',
      icon: './assets/icons/owner_icon.png',
      splash: './assets/splash/owner_splash.png'
    },
    MANAGER: {
      name: 'রংধনু ম্যানেজার',
      slug: 'temp-expo',
      package: 'com.riajulshakib.rongdhonu.manager',
      bundleIdentifier: 'com.riajulshakib.rongdhonu.manager',
      channel: 'manager',
      icon: './assets/icons/manager_icon.png',
      splash: './assets/splash/manager_splash.png'
    }
  };

  const pConfig = PROFILE_CONFIGS[profile];

  // Asset fallback check
  const fallbackAsset = './image/mylogo.png';
  const iconPath = fs.existsSync(path.resolve(__dirname, pConfig.icon)) ? pConfig.icon : fallbackAsset;
  const splashPath = fs.existsSync(path.resolve(__dirname, pConfig.splash)) ? pConfig.splash : fallbackAsset;

  console.log(`[Expo Build Config] Building for APP_PROFILE: '${profile}' (${pConfig.name}) | Package: ${pConfig.package} | Slug: ${pConfig.slug}`);

  // Ensure local credentials.json matches active build profile when building locally
  const profileCreds = path.resolve(__dirname, `credentials/android/credentials.${profile.toLowerCase()}.json`);
  const rootCreds = path.resolve(__dirname, 'credentials.json');
  if (fs.existsSync(profileCreds)) {
    try {
      const pData = fs.readFileSync(profileCreds, 'utf8');
      const curData = fs.existsSync(rootCreds) ? fs.readFileSync(rootCreds, 'utf8') : '';
      if (curData !== pData) {
        fs.writeFileSync(rootCreds, pData, 'utf8');
        console.log(`[Expo Build Config] Synchronized credentials.json for profile '${profile}'`);
      }
    } catch (e) {
      console.warn(`[Expo Build Config] Warning syncing credentials: ${e.message}`);
    }
  }

  return {
    ...config,
    name: pConfig.name,
    slug: pConfig.slug,
    version: config.version || '1.0.9',
    runtimeVersion: '1.0.0',
    orientation: 'portrait',
    icon: iconPath,
    userInterfaceStyle: 'light',
    updates: {
      url: 'https://u.expo.dev/c0ef37bc-f64e-4a5d-8f68-8296556b722a',
      channel: pConfig.channel
    },
    plugins: [
      [
        'expo-splash-screen',
        {
          image: splashPath,
          resizeMode: 'contain',
          backgroundColor: '#ffffff'
        }
      ],
      'expo-sharing',
      'expo-sqlite',
      'react-native-thermal-printer-driver'
    ],
    ios: {
      supportsTablet: true,
      bundleIdentifier: pConfig.bundleIdentifier
    },
    android: {
      adaptiveIcon: {
        backgroundColor: '#ffffff',
        foregroundImage: iconPath
      },
      package: pConfig.package,
      versionCode: config.android?.versionCode || 12,
      // Bluetooth thermal-printer access. BLUETOOTH_SCAN/CONNECT are runtime
      // permissions on Android 12+ and are requested in-app before scanning.
      permissions: [
        'android.permission.BLUETOOTH',
        'android.permission.BLUETOOTH_ADMIN',
        'android.permission.BLUETOOTH_SCAN',
        'android.permission.BLUETOOTH_CONNECT',
        'android.permission.ACCESS_FINE_LOCATION'
      ]
    },
    web: {
      favicon: iconPath
    }
  };
};
