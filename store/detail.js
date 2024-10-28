import Service from '@/services/service.js'

const state = () => ({
  product: null,
  suggested: null,
})
const getters = {
  product: ({ product }) => product,
  suggested: ({ suggested }) => suggested,
}
const mutations = {
  SET_PRODUCT(state, data){
    state.product = data?.data
  },
  UPDATE_WISHLIST(state, data){
    state.product = {...state.product, ...{wishlisted: data?.data ? 1 : null}}
  },
  SET_SUGGESTED_PRODUCTS(state, data){
    state.suggested = data?.data
  },
  EMPTY_SUGGESTED_PRODUCTS(state){
    state.suggested = null
  }
}

const actions = {
  async fetchProduct ({ commit }, {params, lang}) {

    try {
      const {data} = await Service.product(params, lang)

      if(data?.status ){

        if(data?.status === 200){
          commit('SET_PRODUCT', data)

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
  async fetchSuggestedProducts ({ commit }, {id, page, lang}) {
    const {data} = await Service.suggestedProducts(id, page, lang)

    if(data?.status === 200){
      commit('SET_SUGGESTED_PRODUCTS', data)
    }else {
      return Promise.reject({statusCode: data?.status, message: data?.message })
    }

  },
  emptySuggestedProducts ({ commit }) {
    commit('SET_SUGGESTED_PRODUCTS')
  }
}

export {
  state,
  getters,
  mutations,
  actions
}
