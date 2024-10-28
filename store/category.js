import Service from '@/services/service.js'

const state = () => ({
  categories: null
})
const getters = {
  categories: ({ categories }) => categories,
}
const mutations = {
  SET_CATEGORIES(state, data){
    state.categories = data?.data
  },
  EMPTY_CATEGORIES(state){
    state.categories = null
  }
}

const actions = {
   emptyCategories ({ commit }) {
    commit('EMPTY_CATEGORIES')
  },
  async fetchCategories ({ commit }, params) {
    let data = null
     if(params.type === 'brand'){
       data = await Service.brands(params)
     }else {
       data = await Service.categories(params)
     }

    if(data?.status === 200){
      commit('SET_CATEGORIES', data.data)
    }else {
      return Promise.reject({statusCode: data?.status, message: data?.message })
    }

  },
}

export {
  state,
  getters,
  mutations,
  actions
}
