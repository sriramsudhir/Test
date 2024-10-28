import Service from '@/services/service.js'

const state = () => ({
  userToken: null,
  profile: null,
  vouchers: null,
  allAddress: []
})
const getters = {
  userToken: ({userToken}) => userToken,
  profile: ({profile}) => profile,
  vouchers: ({vouchers}) => vouchers,
  allAddress: ({allAddress}) => allAddress
}
const mutations = {
  SET_USER_TOKEN(state, userToken) {
    localStorage.setItem('user_token', userToken)
    state.userToken = userToken
  },
  EMPTY_VOUCHER(state) {
    state.vouchers = null
  },
  SET_PROFILE(state, profile) {
    state.profile = profile
  },
  UPDATE_VOUCHERS(state, vouchers) {
    state.vouchers = vouchers
  },
  ALL_ADDRESS(state, allAddress) {
    state.allAddress = allAddress
  },
  UPDATE_ADDRESS(state, address) {
    const index = state.allAddress.data.findIndex(obj => {
      return parseInt(obj.id) === parseInt(address.id)
    })
    if (index > -1) {
      state.allAddress.data.splice(index, 1, address)
    } else {
      state.allAddress.data.unshift(address)
    }
  }
}

const actions = {
  getUserToken({state, commit}) {
    if (!state.userToken) {
      let token = localStorage.getItem('user_token', null)
      if(!token) {
        token = Math.random().toString(36).slice(2, 5) + (+new Date * Math.random()).toString(36).substring(0, 12) +
          Math.random().toString(36).slice(2, 5)
      }
      commit('SET_USER_TOKEN', token)
    }
    return state.userToken
  },
  async login({commit}, {params, lang}) {
    const {data} = await Service.userLogin(params, lang)
    return data
  },
  async registration({commit}, {params, lang}) {
    const {data} = await Service.userRegistration(params, lang)
    return data
  },
  async verify({commit}, {params, lang}) {
    const {data} = await Service.userVerification(params, lang)
    return data
  },
  async forgotPassword({commit}, {params, lang}) {
    const {data} = await Service.userForgotPassword(params, lang)
    return data
  },
  async updatePassword({commit}, {params, lang}) {
    const {data} = await Service.userUpdatePassword(params, lang)
    return data
  },
  setProfile({commit}, params) {
    commit('SET_PROFILE', params?.data)
  },
  async userVouchers({commit}, {params, lang}) {
    const {data} = await Service.userVouchers(params, this.$auth.strategy.token.get(), lang)
    if (data?.status === 200) {
      commit('UPDATE_VOUCHERS', data.data)
    }
    return data
  },
  async userAddressAll({commit}, params) {
    const {data} = await Service.userAddressAll(params, this.$auth.strategy.token.get())
    if (data?.status === 200) {
      commit('ALL_ADDRESS', data.data)
    }
    return data
  },
  async userAddressAction({commit}, params) {
    const {data} = await Service.userAddressAction(params, this.$auth.strategy.token.get())
    if (data?.status === 200) {
      commit('UPDATE_ADDRESS', data.data)
    }
    return data
  },
  async userAddressDelete({commit}, {id, params}) {
    const {data} = await Service.userAddressDelete(id, this.$auth.strategy.token.get(), params)
    return data
  },
  async updateUserPassword({commit}, params) {
    const {data} = await Service.updateUserPassword(params, this.$auth.strategy.token.get())
    return data
  },
  async updateProfile({commit}, params) {
    const {data} = await Service.updateProfile(params, this.$auth.strategy.token.get())
    return data
  },
  emptyVoucher({commit}) {
    commit('EMPTY_VOUCHER')
  },
}

export {
  state,
  getters,
  mutations,
  actions
}
