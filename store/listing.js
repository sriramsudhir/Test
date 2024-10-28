import Service from '@/services/service.js'

const state = () => ({
  products: null,
  allCategories: null,
  categoryData: null,
  brands: null,
  collections: null,
  shippingRules: null,
  searched: '',
  searchedSuggestion: null
})
const getters = {
  products: ({ products }) => products,
  allCategories: ({ allCategories }) => allCategories,
  categoryData: ({ categoryData }) => categoryData,
  shippingRules: ({ shippingRules }) => shippingRules,
  brands: ({ brands }) => brands,
  collections: ({ collections }) => collections,
  searched: ({ searched }) => searched,
  searchedSuggestion: ({ searchedSuggestion }) => searchedSuggestion
}
const mutations = {
  SET_SEARCHED_SUGGESTION(state, data){
    state.searchedSuggestion = data
  },
  EMPTY_SEARCHED_SUGGESTION(state){
    state.searchedSuggestion = null
  },
  UPDATE_SEARCHED(state, data){
    state.searched = data
  },
  EMPTY_PRODUCTS(state){
    state.products = null
  },
  SET_PRODUCTS(state, data){

    state.products = data?.data?.result


    if(data?.data?.all_categories){
      state.allCategories = data.data.all_categories
    }

    if(data?.data?.category){
      state.categoryData = data.data.category
    }

    if(data?.data?.collections){
      state.collections = data.data.collections
    }

    if(data?.data?.brands){
      state.brands = data.data.brands
    }

    if(data?.data?.shipping){
      state.shippingRules = data.data.shipping
    }
  }
}

const actions = {
  setProducts({ commit }, payload) {
    commit('SET_PRODUCTS', payload)
  },

  updateSearch({ commit }, payload) {
    commit('UPDATE_SEARCHED', payload)
  },
  emptySearchedSuggestion({ commit }) {
    commit('EMPTY_SEARCHED_SUGGESTION')
  },
  emptyProducts({ commit }) {
    commit('EMPTY_PRODUCTS')
  },
  async fetchProducts ({ commit }, params) {
    const {data} = await Service.products(params)

    if(data?.status === 200){
      commit('SET_PRODUCTS', data)
    }else {
      return Promise.reject({statusCode: data?.status, message: data?.message })
    }
  },
  async fetchSearchedSuggestion ({ commit }, {params, lang}) {
    const {data} = await Service.search(params, lang)

    if(data?.status === 200){
      commit('SET_SEARCHED_SUGGESTION', data?.data)
    }else {
      return Promise.reject({statusCode: data?.status, message: data?.message })
    }
  }
}

export {
  state,
  getters,
  mutations,
  actions
}
