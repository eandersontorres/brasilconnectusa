// ════════════════════════════════════════════════════════════════════════════
//   AgendaPro — app da profissional (iOS + Android). Mesmo backend do site.
//   Variáveis EXPO_PUBLIC_* vêm do .env (veja .env.example).
// ════════════════════════════════════════════════════════════════════════════
const fs = require('fs')
const GOOGLE_SERVICES = process.env.GOOGLE_SERVICES_JSON || (fs.existsSync('./google-services.json') ? './google-services.json' : null)

// Modo demonstração (README → "Modo demonstração"): dados de exemplo, sem login e sem backend.
// Trava: nunca deixa ir pra build de produção (loja).
const DEMO = process.env.EXPO_PUBLIC_DEMO === '1'
if (DEMO && process.env.EAS_BUILD_PROFILE === 'production') {
  throw new Error('EXPO_PUBLIC_DEMO=1 não pode ir pra build de loja (perfil production). Tire a variável e rode de novo.')
}
const DEMO_PLANS = ['trial', 'starter', 'pro', 'premium', 'none']

module.exports = {
  expo: {
    name: 'AgendaPro',
    slug: 'agendapro',
    scheme: 'agendapro',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    newArchEnabled: true,
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#FAF7F0',
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.brasilconnect.agendapro',
      buildNumber: '1',
      infoPlist: {
        NSFaceIDUsageDescription: 'Use o Face ID para abrir o AgendaPro com segurança.',
        NSCalendarsUsageDescription: 'O AgendaPro adiciona seus agendamentos no calendário do iPhone.',
        NSCalendarsFullAccessUsageDescription: 'O AgendaPro adiciona e atualiza seus agendamentos no calendário do iPhone.',
        NSPhotoLibraryUsageDescription: 'Escolha fotos do seu trabalho para a sua página e galeria.',
        NSCameraUsageDescription: 'Tire fotos do seu trabalho para a sua página e galeria.',
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      package: 'com.brasilconnect.agendapro',
      versionCode: 1,
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#1F4D3F',
      },
      edgeToEdgeEnabled: true,
      // Push no Android (FCM v1): baixe do Firebase e não versione (está no .gitignore).
      // Sem o arquivo o build segue, só sem push no Android.
      ...(GOOGLE_SERVICES ? { googleServicesFile: GOOGLE_SERVICES } : {}),
      permissions: [
        'android.permission.READ_CALENDAR',
        'android.permission.WRITE_CALENDAR',
        'android.permission.USE_BIOMETRIC',
        'android.permission.USE_FINGERPRINT',
        'android.permission.POST_NOTIFICATIONS',
      ],
    },
    web: {
      favicon: './assets/favicon.png',
      bundler: 'metro',
    },
    plugins: [
      'expo-router',
      'expo-secure-store',
      'expo-web-browser',
      ['expo-notifications', { color: '#1F4D3F' }],
      ['expo-calendar', { calendarPermission: 'O AgendaPro adiciona seus agendamentos no seu calendário.' }],
      ['expo-local-authentication', { faceIDPermission: 'Use o Face ID para abrir o AgendaPro com segurança.' }],
      ['expo-image-picker', {
        photosPermission: 'Escolha fotos do seu trabalho para a sua página e galeria.',
        cameraPermission: 'Tire fotos do seu trabalho para a sua página e galeria.',
      }],
      ['@react-native-community/datetimepicker', {}],
    ],
    experiments: {
      typedRoutes: false,
    },
    extra: {
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://ggwppcbdnemjuddnzbdw.supabase.co',
      supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '',
      apiBase: process.env.EXPO_PUBLIC_API_BASE || 'https://brasilconnectusa.com',
      // 'companion' (padrão: sem preço nem compra no app) ou 'link' (checkout do Stripe). Ver lib/config.js
      purchaseModeIos: process.env.EXPO_PUBLIC_PURCHASE_MODE_IOS || 'companion',
      purchaseModeAndroid: process.env.EXPO_PUBLIC_PURCHASE_MODE_ANDROID || 'companion',
      // Modo demonstração: EXPO_PUBLIC_DEMO=1, plano e ramo opcionais. Ver lib/config.js
      demo: DEMO,
      demoPlan: DEMO_PLANS.includes(process.env.EXPO_PUBLIC_DEMO_PLAN) ? process.env.EXPO_PUBLIC_DEMO_PLAN : 'trial',
      demoVertical: process.env.EXPO_PUBLIC_DEMO_VERTICAL === 'cleaning' ? 'cleaning' : 'services',
      eas: {
        // Preenchido por `eas init` (pede login na conta Expo)
        projectId: process.env.EAS_PROJECT_ID || undefined,
      },
    },
  },
}
