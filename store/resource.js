

const state = () => ({
  countryList: null,
  phoneList: null,
})
const getters = {
  countryList: ({ countryList }) => countryList,
  phoneList: ({ phoneList }) => phoneList,
}
const mutations = {
  SET_COUNTRY_LIST(state, data){
    state.countryList = data
  },
  SET_PHONE_LIST(state, data){
    state.phoneList = data
  },
}

const actions = {
  setCountryList ({ commit }, list) {
    commit('SET_COUNTRY_LIST', list)
  },
  setPhoneList ({ commit }, list) {
    commit('SET_PHONE_LIST', list)
  }
}

export {
  state,
  getters,
  mutations,
  actions
}
