import Service from '@/services/service.js'

const state = () => ({
  langData: null,
  langCode: false,
  languages: {},
  defaultLanguage: {
    name: 'English',
    code: 'en'
  },
  currentLanguage: {
    name: 'English',
    code: 'en'
  },
})
const getters = {
  langCode: ({langCode}) => langCode,
  languages: ({languages}) => languages,
  currentLanguage: ({currentLanguage}) => currentLanguage,
  defaultLanguage: ({defaultLanguage}) => defaultLanguage,
  langData: ({langData}) => langData
}
const mutations = {
  SET_LANG_CODE(state, langCode) {
    state.langCode = langCode
  },
  SET_CURRENT_LANGUAGE(state, currentLanguage) {
    state.currentLanguage = currentLanguage
  },
  SET_DEFAULT_LANGUAGE(state, defaultLanguage) {
    state.defaultLanguage = defaultLanguage
  },
  SET_LANGUAGES(state, languages) {
    languages.forEach(i => {
      state.languages[i.code] = i
    })
  },
  SET_LANG_DATA(state, langData) {
    state.langData = langData
  },
}

const actions = {
  setLangCode({commit}, payload) {
    commit('SET_LANG_CODE', payload)
  },
  setCurrentLanguage({commit}, payload) {
    commit('SET_CURRENT_LANGUAGE', payload)
  },
  setDefaultLanguage({commit}, payload) {
    commit('SET_DEFAULT_LANGUAGE', payload)
  },

  setLocalMessages({state, dispatch}, i18n) {
    if(!state?.langData){

      dispatch('getLangData', i18n)

    } else if(!state?.currentLanguage?.predefined) {

      i18n.setLocaleMessage(state?.currentLanguage?.code, state?.langData)
    }
  },
  async getLangData({state, commit, dispatch}, i18n) {

    if (!state?.currentLanguage?.predefined) {
      try {

        const {data} = await Service.getRequest({
            locale_code: state?.currentLanguage?.code
          },
          'localization'
        )

        if (data?.status) {

          if (data?.status === 200) {

            commit('SET_LANG_DATA', data?.data)

            i18n.setLocaleMessage(state?.currentLanguage?.code, data?.data)

          }

        } else {

          return Promise.reject({
            message: "API is down."
          })
        }
      } catch (e) {

        return Promise.reject({
          message: e.message
        })
      }
    }
  },

}

export {
  state,
  getters,
  mutations,
  actions
}
