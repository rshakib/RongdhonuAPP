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

  return {
    ...config,
    name: pConfig.name,
    slug: pConfig.slug,
    version: config.version || '1.0.1',
    runtimeVersion: {
      policy: 'appVersion'
    },
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
      'expo-sqlite'
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
      versionCode: config.android?.versionCode || 2
    },
    web: {
      favicon: iconPath
    },
    "extra": {
      "eas": {
        "projectId": "5bbb3050-c514-4ce8-88f4-655a9cec68ba"
      }
    },
    "owner": "shakib223"
  };
};
