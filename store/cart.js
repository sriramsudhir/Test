import Service from '@/services/service.js'
// import util from '@/mixin/util.js'

const state = () => ({
  cartCount: 0,
  cartProducts: []
})
const getters = {
  cartCount: ({ cartCount }) => cartCount,
  cartProducts: ({ cartProducts }) => cartProducts
}
const mutations = {
  UPDATE_SELECTED (state, obj) {
    state.cartProducts[obj.key].selected = obj.value
  },
  SET_CART_COUNT (state, cartCount) {
    state.cartCount = cartCount
  },
  DELETE_CART (state, cartProduct) {
    const index = state.cartProducts.findIndex((obj) => {
      return obj.id === cartProduct.id
    })
    state.cartProducts.splice(index, 1)
    state.cartCount -= parseInt(cartProduct.quantity)
  },
  INCREASE_CART_COUNT (state, cartCount) {
    state.cartCount = parseInt(state.cartCount) + parseInt(cartCount)
  },
  SUBTRACT_CART_COUNT (state, cartCount) {
    state.cartCount = parseInt(state.cartCount) - parseInt(cartCount)
  },
  SET_CART_PRODUCTS (state, cartProducts) {
    state.cartProducts = cartProducts
    state.cartCount = cartProducts.reduce((accum, item) => accum + parseInt(item.quantity), 0)
  },
  CART_PRODUCT_ACTION (state, cartProduct) {
    const index = state.cartProducts.findIndex((obj) => {
      return obj.id === cartProduct.id
    })

    if(index === -1){
      state.cartProducts.push(cartProduct)
    } else {
      state.cartProducts[index].quantity = 0
      state.cartProducts[index].quantity = cartProduct.quantity
    }
  },
  EMPTY_CART_PRODUCT(state) {
    state.cartProducts = []
    state.cartCount = 0
  },
  EMPTY_CART_PRODUCT_ONLY(state, status) {
    state.cartProducts = state.cartProducts.filter(i=>{
      return parseInt(i.selected) !== status.PUBLIC
    })
  },
  INSERT_CART_SHIPPING(state, cartProducts) {
    state.cartProducts = cartProducts
  }
}

const actions = {
  async getCartByUser ({ commit }, {lang, params}) {

    const {data} = await Service.cartByUser(this.$auth.strategy.token.get(), lang, {user_token: params.user_token})

    if(data?.status === 200){
      commit('SET_CART_PRODUCTS', data.data)
    }else {
      return Promise.reject({statusCode: data?.status, message: data.message })
    }

  },
  async buyNow ({ commit, dispatch }, {payload, lang}) {
    const {data} = await Service.buyNow(payload, this.$auth.strategy.token.get())

    if(data?.status === 200){
      dispatch('getCartByUser', {
        lang: lang,
        params: payload
      })
    }

    return data
  },
  async cartAction ({ commit, dispatch }, {payload, lang}) {
    const apiVal = payload.apiVal
    const storeVal = payload.storeVal

    const {data} = await Service.cartAction(apiVal, this.$auth.strategy.token.get())
    if(data?.status === 200){
      commit('common/SET_TOAST_MESSAGE', this.$i18n.t('cart.productAdded'), {root: true})

      if(payload.isBundle){
        dispatch('getCartByUser', {
          lang: lang,
          params: payload
        })
      }
      commit('CART_PRODUCT_ACTION', {...storeVal, ...{id: data.data.id}, ...{quantity: data.data.quantity}})

      commit('INCREASE_CART_COUNT', storeVal.quantity)

    } else if(data?.status === 201) {
      commit('common/SET_TOAST_ERROR', data?.data?.form[0], {root: true})
    } else {
      return Promise.reject({statusCode: data?.status, message: data.message })
    }
  },
  async cartDelete ({ commit, dispatch }, {payload, lang}) {
    const {data} = await Service.cartDelete(payload.id, this.$auth.strategy.token.get())
    if(data?.status === 200){
      dispatch('getCartByUser', {params: payload, lang: lang})
      commit('DELETE_CART', data.data)
    }else {
      return Promise.reject({statusCode: data?.status, message: data.message })
    }
  },
  async cartChanged ({ state, commit, dispatch }, {payload, lang}) {
    const req = {
      checked: payload.checked,
      unchecked: [],
      isBundle: false
    }

    state.cartProducts.forEach((obj,key) => {
      if(req.checked.indexOf(parseInt(obj.id)) === -1){
        req.unchecked.push(obj.id)

        commit('UPDATE_SELECTED', {
          key: key,
          value: 2,
        })
      }else{
        commit('UPDATE_SELECTED', {
          key: key,
          value: 1,
        })
      }
      if(!req.isBundle && obj.bundle_deal){
        req.isBundle = true
      }
    })

    const {data} = await Service.cartChanged(req, this.$auth.strategy.token.get())
    if(data?.status !== 200){
      commit('common/SET_TOAST_ERROR', data.data.form[0], {root: true})

    }else {
      if(req.isBundle){
        dispatch('getCartByUser', {lang: lang})
      }
    }
  },
  async updateCartShipping ({ commit }, payload) {
    const {data} = await Service.updateCartShipping(payload, this.$auth.strategy.token.get())
    if(data?.status === 200){
      commit('INSERT_CART_SHIPPING', data.data)
    }
    return data
  },
  emptyCartProduct ({ commit }) {
    commit('EMPTY_CART_PRODUCT')
  },
  subtractCartProductCount ({ commit }, payload) {
    commit('EMPTY_CART_PRODUCT_ONLY', payload?.status)
    commit('SUBTRACT_CART_COUNT', payload.qty)
  },
  setCartCount ({ commit }, count) {
    commit('SET_CART_COUNT', count)
  },
}

export {
  state,
  getters,
  mutations,
  actions
}
