import Service from '@/services/service.js'

const state = () => ({
  products: null,
})
const getters = {
  products: ({ products }) => products,
}
const mutations = {
  SET_PRODUCTS(state, data){
    state.products = data?.data
  }
}

const actions = {
  async emptyFlashProducts ({ commit }) {
    commit('SET_PRODUCTS', {
      data: null
    })
  },


  async fetchFlashProducts ({ commit }, {params, lang}) {
    try {

      const {data} = await Service.flashProducts(params, lang)

      if(data?.status === 200){
        commit('SET_PRODUCTS', data)
      }else if(data?.status === 201){

        return Promise.reject({
          statusCode: data?.status, message: data?.message
        })
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
  async fetchFlashSales ({ commit }, {lang}) {

    try {
      const { data } = await Service.flashSales(lang)
      if(data?.status){


        if(data?.status === 200){
          commit('home/SET_FLASH_SALES', data.data, {root: true})

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
