import Service from '@/services/service.js'

const state = () => ({
  slider: null,
  banners: null,
  collections: null,
  site_features: null,
  featured_categories: null,
  featured_brands: null,
  flash_sales: null,
  products: null,
  hasHomeData: false
})
const getters = {
  hasHomeData: ({ hasHomeData }) => hasHomeData,
  slider: ({ slider }) => slider,
  siteFeatures: ({ site_features }) => site_features,
  collections: ({ collections }) => collections,
  banners: ({ banners }) => banners,
  featuredCategories: ({ featured_categories }) => featured_categories,
  featuredBrands: ({ featured_brands }) => featured_brands,
  flashSales: ({ flash_sales }) => flash_sales,
  products: ({ products }) => products
}
const mutations = {
  SET_FLASH_SALES(state, data){
    state.flash_sales =  data
  },
  SET_HOME_DATA(state, data){
    const home = data.data
    state.slider = home?.slider
    state.site_features = home?.site_features
    state.hasHomeData = true
    state.banners =  home?.banners
    state.collections =  home?.collections
    state.featured_categories =  home?.featured_categories
    state.featured_brands =  home?.featured_brands
    state.flash_sales =  home?.flash_sales
  },
  SET_PRODUCTS(state, data){
    state.products = data?.data?.result
  }
}

const actions = {
  async fetchHome ({ commit }, {payload, lang}) {
    commit('common/SET_LOADING', true, {root: true})

    try {
      const {data} = await Service.home(payload, lang)

      if(data?.status){

        if(data?.status === 200) {
          commit('SET_HOME_DATA', data)
          commit('common/SET_LOADING', false, {root: true})

        }else if(data?.status === 201){

          return Promise.reject({
            statusCode: data.status, message: data.message
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
  async fetchProducts ({ commit }, {payload, lang}) {

    try {
      const {data} = await Service.products(payload, lang)

      if(data?.status){

        if(data?.status === 200){
          commit('SET_PRODUCTS', data)

          return data?.data?.result
        } else {

          return Promise.reject({
            statusCode: data.status, message: data.message
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

  }
}

export {
  state,
  getters,
  mutations,
  actions
}
