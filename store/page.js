import Service from '@/services/service.js'

const state = () => ({
  page: null,
})
const getters = {
  page: ({ page }) => page
}
const mutations = {
  SET_PAGE(state, data){
    state.page = data?.data
  },
}

const actions = {
  async fetchPageData({ commit }, {params, lang}) {
    try {




      const {data} = await Service.page(params, lang)

      if(data?.status){

        if(data?.status === 200){
          commit('SET_PAGE', data)

        }else if(data?.status === 201){

          return Promise.reject({
            statusCode: data?.status, message: data?.message
          })
        }


      } else {

        return Promise.reject({
          message: "API is down."
        })
      }
    }catch (e) {

      return Promise.reject({
        message: e.message
      })
    }

  },
}

export {
  state,
  getters,
  mutations,
  actions
}
