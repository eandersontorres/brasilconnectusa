// ════════════════════════════════════════════════════════════════════════════
//   Um projeto, dois apps nas lojas (mesmo backend do site e mesma assinatura):
//     APP_VARIANT=agendapro (padrão) → AgendaPro: agenda de beleza, bem-estar e limpeza
//     APP_VARIANT=workpro            → WorkPro: orçamento e fatura pra construção,
//                                      handyman, marceneiro, tradutor juramentado...
//   Variáveis EXPO_PUBLIC_* vêm do .env (veja .env.example). Ver lib/variant.js.
// ════════════════════════════════════════════════════════════════════════════
const fs = require('fs')
const GOOGLE_SERVICES = process.env.GOOGLE_SERVICES_JSON || (fs.existsSync('./google-services.json') ? './google-services.json' : null)

const VARIANTS = {
  agendapro: {
    name: 'AgendaPro',
    slug: 'agendapro',
    scheme: 'agendapro',
    bundle: 'com.brasilconnect.agendapro',
    icon: './assets/icon.png',
    adaptiveIcon: './assets/adaptive-icon.png',
    splash: './assets/splash-icon.png',
    favicon: './assets/favicon.png',
    primary: '#1F4D3F',
    photosText: 'Escolha fotos do seu trabalho para a sua página e galeria.',
    cameraText: 'Tire fotos do seu trabalho para a sua página e galeria.',
  },
  workpro: {
    name: 'WorkPro',
    slug: 'workpro',
    scheme: 'workpro',
    bundle: 'com.brasilconnect.workpro',
    icon: './assets/workpro/icon.png',
    adaptiveIcon: './assets/workpro/adaptive-icon.png',
    splash: './assets/workpro/splash-icon.png',
    favicon: './assets/workpro/favicon.png',
    primary: '#1B2845',
    photosText: 'Escolha fotos do trabalho para orçamentos, faturas e sua página.',
    cameraText: 'Tire fotos de antes e depois do trabalho para orçamentos e faturas.',
  },
}
const VARIANT = VARIANTS[process.env.APP_VARIANT] ? process.env.APP_VARIANT : 'agendapro'
const V = VARIANTS[VARIANT]
// Arquivo de ícone que ainda não existe (ex.: antes de gerar os da WorkPro) cai no do AgendaPro
const asset = (p, fallback) => (fs.existsSync(p) ? p : fallback)

// Modo demonstração (README → "Modo demonstração"): dados de exemplo, sem login e sem backend.
// Trava: nunca deixa ir pra build de produção (loja).
const DEMO = process.env.EXPO_PUBLIC_DEMO === '1'
if (DEMO && process.env.EAS_BUILD_PROFILE && process.env.EAS_BUILD_PROFILE.startsWith('production')) {
  throw new Error('EXPO_PUBLIC_DEMO=1 não pode ir pra build de loja (perfil production). Tire a variável e rode de novo.')
}
const DEMO_PLANS = ['trial', 'starter', 'pro', 'premium', 'none']
const DEMO_VERTICALS = ['services', 'cleaning', 'trades']

module.exports = {
  expo: {
    name: V.name,
    slug: V.slug,
    scheme: V.scheme,
    version: '1.0.0',
    orientation: 'portrait',
    icon: asset(V.icon, VARIANTS.agendapro.icon),
    userInterfaceStyle: 'light',
    newArchEnabled: true,
    splash: {
      image: asset(V.splash, VARIANTS.agendapro.splash),
      resizeMode: 'contain',
      backgroundColor: '#FAF7F0',
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: V.bundle,
      buildNumber: '1',
      infoPlist: {
        NSFaceIDUsageDescription: `Use o Face ID para abrir o ${V.name} com segurança.`,
        NSCalendarsUsageDescription: `O ${V.name} adiciona seus agendamentos no calendário do iPhone.`,
        NSCalendarsFullAccessUsageDescription: `O ${V.name} adiciona e atualiza seus agendamentos no calendário do iPhone.`,
        NSPhotoLibraryUsageDescription: V.photosText,
        NSCameraUsageDescription: V.cameraText,
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      package: V.bundle,
      versionCode: 1,
      adaptiveIcon: {
        foregroundImage: asset(V.adaptiveIcon, VARIANTS.agendapro.adaptiveIcon),
        backgroundColor: V.primary,
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
      favicon: asset(V.favicon, VARIANTS.agendapro.favicon),
      bundler: 'metro',
    },
    plugins: [
      'expo-router',
      'expo-secure-store',
      'expo-web-browser',
      ['expo-notifications', { color: V.primary }],
      ['expo-calendar', { calendarPermission: `O ${V.name} adiciona seus agendamentos no seu calendário.` }],
      ['expo-local-authentication', { faceIDPermission: `Use o Face ID para abrir o ${V.name} com segurança.` }],
      ['expo-image-picker', { photosPermission: V.photosText, cameraPermission: V.cameraText }],
      ['@react-native-community/datetimepicker', {}],
    ],
    experiments: {
      typedRoutes: false,
    },
    extra: {
      variant: VARIANT,
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://ggwppcbdnemjuddnzbdw.supabase.co',
      supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '',
      apiBase: process.env.EXPO_PUBLIC_API_BASE || 'https://brasilconnectusa.com',
      // 'companion' (padrão: sem preço nem compra no app) ou 'link' (checkout do Stripe). Ver lib/config.js
      purchaseModeIos: process.env.EXPO_PUBLIC_PURCHASE_MODE_IOS || 'companion',
      purchaseModeAndroid: process.env.EXPO_PUBLIC_PURCHASE_MODE_ANDROID || 'companion',
      // Modo demonstração: EXPO_PUBLIC_DEMO=1, plano e ramo opcionais. Ver lib/config.js
      demo: DEMO,
      demoPlan: DEMO_PLANS.includes(process.env.EXPO_PUBLIC_DEMO_PLAN) ? process.env.EXPO_PUBLIC_DEMO_PLAN : 'trial',
      demoVertical: DEMO_VERTICALS.includes(process.env.EXPO_PUBLIC_DEMO_VERTICAL)
        ? process.env.EXPO_PUBLIC_DEMO_VERTICAL
        : (VARIANT === 'workpro' ? 'trades' : 'services'),
      eas: {
        // Cada app tem o seu projeto no EAS (`eas init` com APP_VARIANT definido)
        projectId: (VARIANT === 'workpro' ? process.env.EAS_PROJECT_ID_WORKPRO : process.env.EAS_PROJECT_ID) || undefined,
      },
    },
  },
}
