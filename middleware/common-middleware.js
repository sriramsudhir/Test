export default function ({ app, store  }) {
  app.i18n.locale = store?.state?.language?.currentLanguage?.code
}
