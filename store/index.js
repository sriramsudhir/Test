import Service from '@/services/service.js'

const state = () => ({
  imgSrcUrl: '',
  defaultImage: '',
  thumbPrefix: '',
})
const getters = {
  defaultImage: ({defaultImage}) => defaultImage,
  imgSrcUrl: ({imgSrcUrl}) => imgSrcUrl,
  thumbPrefix: ({thumbPrefix}) => thumbPrefix,
}

const mutations = {
  SET_DEFAULT_IMAGE(state, defaultImage) {
    state.defaultImage = defaultImage
  },
  SET_IMG_SRC_URL(state, imgSrcUrl) {
    state.imgSrcUrl = imgSrcUrl
  },
  SET_THUMB_PREFIX(state, thumbPrefix) {
    state.thumbPrefix = thumbPrefix
  },
}

const actions = {
  async nuxtServerInit({commit, dispatch, state}, {error, req, app}) {


    try {
      const cookies = req.headers.cookie;
      const currentLanguage = cookies && cookies.includes('currentLanguage=') ? cookies.split('currentLanguage=')[1].split(';')[0] : '';

      const {data} = await Service.common(currentLanguage)

      if (data?.status) {

        if (data?.status === 200) {
          commit('SET_DEFAULT_IMAGE', data.data.default_image)
          commit('SET_IMG_SRC_URL', data.data.img_src_url)
          commit('SET_THUMB_PREFIX', data.data.thumb_prefix)
          commit('common/SET_COMMON_DATA', data, {root: true})



          commit('language/SET_LANGUAGES', data.data.languages, {root: true})

          if (data.data?.default_language) {
            dispatch('language/setDefaultLanguage', data.data.default_language)
          }


          if (currentLanguage && state.language.languages[currentLanguage]) {

            dispatch('language/setCurrentLanguage', state.language.languages[currentLanguage])

          } else if (data.data?.default_language) {
            dispatch('language/setCurrentLanguage', data.data.default_language)
          }

          if (state.language.currentLanguage?.code?.trim() !== state.language.defaultLanguage?.code?.trim()) {
            dispatch('language/setLangCode', state.language.currentLanguage.code)
          } else {
            dispatch('language/setLangCode', false)
          }


          await dispatch('language/getLangData', app.i18n)


        } else if (data?.status === 201) {
          return error({
            statusCode: data?.status, message: data?.message
          })
        }
      } else {
        return error({
          message: "API is down."
        })
      }
    } catch (e) {
      return error({
        message: e.message
      })
    }
  },
  async nuxtClientInit({commit, state, dispatch}, {error, app}) {
    //const cookies = req.headers.cookie;
    //const defaultLanguage = cookies && cookies.includes('defaultLanguage=') ? cookies.split('defaultLanguage=')[1].split(';')[0] : 'en';

    const cookies = document.cookie
    const currentLanguage = cookies && cookies.includes('currentLanguage=') ? cookies.split('currentLanguage=')[1].split(';')[0] : '';


    if (!state.common?.categories && !state.common?.about) {

      try {
        const {data} = await Service.common(currentLanguage)
        if (data?.status) {

          if (data?.status === 200) {
            commit('common/SET_COMMON_DATA', data, {root: true})
            commit('language/SET_LANGUAGES', data.data.languages, {root: true})
            commit('SET_DEFAULT_IMAGE', data.data.default_image)
            commit('SET_IMG_SRC_URL', data.data.img_src_url)
            commit('SET_THUMB_PREFIX', data.data.thumb_prefix)

            if (data.data?.default_language) {
              dispatch('language/setDefaultLanguage', data.data.default_language)
            }


            if (currentLanguage && state.language.languages[currentLanguage]) {
              dispatch('language/setCurrentLanguage', state.language.languages[currentLanguage])

            } else if (data.data?.default_language) {

              dispatch('language/setCurrentLanguage', data.data?.default_language)
            }


            if (state.language.currentLanguage?.code?.trim() !== state.language.defaultLanguage?.code?.trim()) {
              dispatch('language/setLangCode', state.language.currentLanguage.code)

            } else {
              dispatch('language/setLangCode', false)
            }

            await dispatch('language/getLangData', app.i18n)

            app.i18n.locale = state.language?.currentLanguage?.code

          } else if (data?.status === 201) {

            return error({
              statusCode: data?.status, message: data?.message
            })
          }
        } else {
          return error({
            message: "API is down."
          })
        }
      } catch (e) {

        return error({
          message: e.message
        })
      }
    } else {

      if (currentLanguage) {

        app.i18n.locale = currentLanguage
        dispatch('language/setLocalMessages', app.i18n)
        // app.i18n.setLocaleMessage(state.language?.currentLanguage?.code, state?.language?.langData)


      } else {


        app.i18n.locale = state.language?.currentLanguage?.code
        dispatch('language/setLocalMessages', app.i18n)


        // app.i18n.setLocaleMessage(state.language?.currentLanguage?.code, state?.language?.langData)

      }

    }
  }
}

export {
  state,
  getters,
  mutations,
  actions
}
