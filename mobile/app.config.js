// ════════════════════════════════════════════════════════════════════════════
//   Expo app config — lê Supabase URL/anon key do env. Variáveis com prefixo
//   EXPO_PUBLIC_* viram acessíveis também via process.env no runtime do app.
// ════════════════════════════════════════════════════════════════════════════
module.exports = {
  expo: {
    name: 'BrasilConnect',
    slug: 'brasilconnect',
    scheme: 'brasilconnect',
    version: '0.1.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    newArchEnabled: true,
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#FAFAF9',
    },
    ios: {
      supportsTablet: false,
      bundleIdentifier: 'com.brasilconnect.app',
    },
    android: {
      package: 'com.brasilconnect.app',
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#FAFAF9',
      },
      edgeToEdgeEnabled: true,
    },
    web: {
      favicon: './assets/favicon.png',
    },
    plugins: [
      'expo-router',
      'expo-font',
      [
        'expo-calendar',
        {
          calendarPermission: 'Permitir o BrasilConnect adicionar eventos no seu calendário.',
        },
      ],
    ],
    experiments: {
      typedRoutes: false,
    },
    extra: {
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL || '',
      supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '',
      apiBase: process.env.EXPO_PUBLIC_API_BASE || 'https://brasilconnect.com',
    },
  },
}
