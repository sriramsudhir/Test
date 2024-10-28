const configJson = require('./config.json')

let apiBase = !process.env.API_BASE.trim() ? '/' : process.env.API_BASE
apiBase += configJson.api.url

export default {
  ssr: process.env.SSR === 'true',
  serverMiddleware: [
    { path: "/sitemap.xml", handler: "~/api/sitemap/index.js" },
    { path: "/robots.txt", handler: "~/api/robots/index.js" },
  ],
  env: {
    apiBase: process.env.API_BASE
  },
  head: {
    meta: [
      {charset: 'utf-8'},
      {
        name: 'viewport',
        content: 'width=device-width,initial-scale=1,maximum-scale=1,minimum-scale=1'
      },
    ],
    link: [
      { rel: 'icon', type: 'image/x-icon', href: '/favicon.png' }
    ]
  },
  css: [
    '~/assets/styles/styles.styl',
    '@glidejs/glide/dist/css/glide.core.min.css'
  ],
  //Progress bar color
  loading: {color: '#39b982'},

  // Plugins to run before rendering page: https://go.nuxtjs.dev/config-plugins
  plugins: [

    {src: '~/plugins/vue-product-zoomer.js', mode: 'client'},
    {src: '~/plugins/vue-social-sharing.js', mode: 'client'},
    {src: '~/plugins/v-drag.js', mode: 'client'},
    {src: '~/plugins/cryptojs.js', mode: 'client'},
    {src: '~/plugins/nuxt-client-init.js', ssr: false},
    {src: '~/plugins/dompurify.js'}
  ],

  // Auto import components: https://go.nuxtjs.dev/config-components
  components: true,

  // Modules for dev and build (recommended): https://go.nuxtjs.dev/config-modules
  buildModules: [
    '@nuxtjs/moment'
  ],
  // Modules: https://go.nuxtjs.dev/config-modules
  modules: [
    // https://go.nuxtjs.dev/axios
    '@nuxtjs/axios',
    '@nuxtjs/auth-next',
    '@nuxtjs/i18n',
    '@nuxtjs/pwa'
  ],
  auth: {
    cookie:{
      prefix: 'frontend_',
      options: {
        expires: new Date(new Date().getTime()+20000000000).getTime(), //thats today + a year
        maxAge: 31622400
      },
    },
    localStorage: false,
    strategies: {
      local: {
        token: {
          property: 'data.token',
          // required: true,
          // type: 'Bearer'
        },
        user: {
          property: 'data',
          autoFetch: true
        },
        endpoints: {
          login: {url: apiBase + configJson.api.login, method: 'post'},
          logout: {url: apiBase + configJson.api.logout, method: 'get'},
          user: false
          /*user: {url: apiBase + configJson.api.profile, method: 'get'}*/
        }
      }
    }
  },
  axios: {},

  build: {
    transpile: [
      'defu',
    ]
  },

  i18n: {
    locales: [
      {
        code: 'en',
        file: 'en.json'
      },
      {
        code: 'fr',
        file: 'fr.json'
      },
      {
        code: 'ar',
        file: 'ar.json'
      },
      {
        code: 'tr',
        file: 'tr.json'
      },
      {
        code: 'hi',
        file: 'hi.json'
      }
    ],
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: 'i18n_redirected'
    },
    lazy: false,
    langDir: 'lang/',
    defaultLocale: 'en'
  },
  pwa: {
    themeColor: "#081d4d",
    backgroundColor: "#FFFFFF",
    icon: {
      fileName: 'pwa-icon.png',
      purpose: "any"
    },
  },
/*  server: {
    port: 3001,
    host: '0.0.0.0',
  },*/
}
