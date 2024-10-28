export default {
  data() {
    return {
    }
  },
  methods: {
    commonMeta({meta_title, meta_description, meta_keywords, header_logo, api_base, site_url, styling}) {
      const domain = site_url?.replace(/^https?:\/\//, '')
      const path = site_url?.replace(/\/+$/, '') + this.$route.path

      return {
        title: meta_title,
        htmlAttrs: {
          lang: 'en'
        },
        meta: [
          {charset: 'utf-8'},
          {
            name: 'viewport',
            content: 'width=device-width,initial-scale=1,maximum-scale=1,minimum-scale=1'
          },
          {hid: 'description', name: 'description', content: meta_description},
          {hid: 'keywords', name: 'keywords', content: meta_keywords},
          {
            hid: 'og:title',
            name: 'og:title',
            content: `${domain} | ${meta_title}`,
            'data-rh': "true"
          },
          {hid: 'og:type', name: 'og:type', content: 'website', 'data-rh': "true"},
          {hid: 'robots', name: 'robots', content: 'all', 'data-rh': "true"},
          {hid: 'og:url', name: 'og:url', content: path, 'data-rh': "true"},
          {
            hid: 'og:image', name: 'og:image', 'xmlns:og': "http://opengraphprotocol.org/schema/",
            content: header_logo
          },
          {
            hid: 'og:description', name: 'og:description', 'xmlns:og': "http://opengraphprotocol.org/schema/",
            content: meta_description
          }
        ],
        link: [
          {rel: 'icon', type: 'image/png', href: '/favicon.png'},
          {rel: 'canonical', path},
          {rel: 'dns-prefetch', href: api_base},
          {
            rel: 'preload',
            as: 'font',
            href:
              `https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;600&display=swap`
          }
        ],
        style: [
          { cssText: styling, type: 'text/css' }
        ]
      }
    },
    generatingMeta(name, content) {
      return {
        hid: name,
        name: name,
        content: content
      }
    }
  }
}
