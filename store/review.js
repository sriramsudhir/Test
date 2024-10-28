import Service from '@/services/service.js'

const state = () => ({
  allReviews: [],
  totalReviews: [],
  banner: null,
})
const getters = {
  banner: ({ banner }) => banner,
  allReviews: ({ allReviews }) => allReviews,
  totalReviews: ({ totalReviews }) => totalReviews
}
const mutations = {
  EMPTY_REVIEWS (state) {
    state.totalReviews = []
    state.allReviews = []
  },
  SET_ALL_REVIEWS (state, reviews) {
    if(reviews?.total){
      state.totalReviews = reviews?.total
      state.banner = reviews?.banner
    }
    state.allReviews = reviews.all
  },
}

const actions = {
  async emptyReviews ({ commit }) {
    commit('EMPTY_REVIEWS')
  },
  async fetchReviews ({ commit }, params) {
    const {data} = await Service.reviews(params)

    if(data?.status === 200){
      commit('SET_ALL_REVIEWS', data.data)
    }else {
      return Promise.reject({statusCode: data.status, message: data.message })
    }
    return data
  },
}

export {
  state,
  getters,
  mutations,
  actions
}
