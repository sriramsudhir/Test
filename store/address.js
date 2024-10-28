import Service from '@/services/service.js'

const state = () => ({
  addresses: []
})
const getters = {
  addresses: ({ addresses }) => addresses
}
const mutations = {
  DELETE_ADDRESS (state, address) {
    const index = state.addresses.findIndex((obj) => {
      return obj.id === address.id
    })
    state.addresses.splice(index, 1)
  },
  SET_ADDRESSES (state, addresses) {
    state.addresses = addresses
  },
  ADDRESS_ACTION (state, address) {
    const index = state.addresses.findIndex((obj) => {
      return obj.id === address.id
    })
    if(index === -1){
      state.addresses.unshift(address)
    } else {
      state.addresses[index] = address
    }
  }
}

const actions = {
  async getAddressByUser ({ commit }) {
    const {data} = await Service.addressByUser(this.$auth.user.id, this.$auth.strategy.token.get())
    commit('SET_ADDRESSES', data.data)
    return data
  },
  async addressAction ({ commit, dispatch }, address) {
    const {data} = await Service.addressAction(address, this.$auth.strategy.token.get())
    if(data?.status === 200){
      let mess = 'added'
      if(address.id){
        mess = 'updated'
      }
      commit('common/SET_TOAST_MESSAGE', this.$i18n.t('filter.addSucc', {msg: mess}), {root: true})
      commit('ADDRESS_ACTION', data.data)
    } else {
      commit('common/SET_TOAST_ERROR', data.data.form[0], {root: true})
    }
    return data
  },
  async addressDelete ({ commit, dispatch }, id) {
    const {data} = await Service.addressDelete(id, this.$auth.strategy.token.get())
    if(data?.status === 200){
      commit('DELETE_ADDRESS', data.data)
    }
    return data
  }
}

export {
  state,
  getters,
  mutations,
  actions
}
