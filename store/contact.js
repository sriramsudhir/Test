import Service from '@/services/service.js'

const state = () => ({

})
const getters = {

}
const mutations = {
}

const actions = {
  async contactUs ({ commit }, params) {

    try {
      const {data} = await Service.contactUs(params)

      if(data?.status){

        return data

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
  }
}

export {
  state,
  getters,
  mutations,
  actions
}
