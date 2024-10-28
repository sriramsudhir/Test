import axios from 'axios'
import json from '~/config.json'

const apiBase = !process.env.apiBase.trim() ? window.location.origin + '/' : process.env.apiBase

const apiClient = axios.create({
  baseURL: apiBase + json.api.url,
  withCredentials: false,
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json'
  }
})

export default {
  common(lang = null) {
    if (lang) {
      apiClient.defaults.headers['Lang'] = lang
    } else {
      if (apiClient.defaults.headers?.Lang) {
        delete apiClient.defaults.headers['Lang']
      }
    }

    return apiClient.get(json.api.common)
  },
  home(params, lang = null) {

    if (lang) {
      apiClient.defaults.headers['Language'] = lang
    } else {
      if (apiClient.defaults.headers?.Language) {
        delete apiClient.defaults.headers['Language']
      }
    }

    return apiClient.get(json.api.home, {params: params})
  },
  categories(params, lang = null) {
    if (lang) {
      apiClient.defaults.headers['Language'] = lang
    } else {
      if (apiClient.defaults.headers?.Language) {
        delete apiClient.defaults.headers['Language']
      }
    }

    return apiClient.get(json.api.categories, {
      params: params
    })
  },
  brands(params, lang = null) {
    if (lang) {
      apiClient.defaults.headers.common['Language'] = lang
    }

    return apiClient.get(json.api.brands, {
      params: params
    })
  },
  products(params, lang = null) {
    if (lang) {
      apiClient.defaults.headers.common['Language'] = lang
    }

    return apiClient.get(json.api.products, {
      params: params
    })
  },
  flashProducts(params, lang = null) {
    if (lang) {
      apiClient.defaults.headers.common['Language'] = lang
    }

    return apiClient.get(`${json.api.flashProducts}/${params.id}`, {
      params: params
    })
  },
  flashSales(lang = null) {
    if (lang) {
      apiClient.defaults.headers.common['Language'] = lang
    }

    return apiClient.get(`${json.api.flashSales}`)
  },
  search(params, lang = null) {
    if (lang) {
      apiClient.defaults.headers.common['Language'] = lang
    }

    return apiClient.get(json.api.search, {
      params: params
    })
  },
  product(params, lang = null) {
    if (lang) {
      apiClient.defaults.headers['Language'] = lang
    } else {
      if (apiClient.defaults.headers?.Language) {
        delete apiClient.defaults.headers['Language']
      }
    }

    return apiClient.get(`${json.api.product}/${params.id}`, {
      params: params
    })
  },
  page(params, lang = null) {

    if (lang) {
      apiClient.defaults.headers['Language'] = lang
    } else {
      if (apiClient.defaults.headers?.Language) {
        delete apiClient.defaults.headers['Language']
      }
    }

    return apiClient.get(`${json.api.page}/${params.slug}`)
  },
  reviews(params) {
    return apiClient.get(`${json.api.reviews}/${params.id}`, {
      params: params
    })
  },
  suggestedProducts(id, page, lang = null) {
    if (lang) {
      apiClient.defaults.headers.common['Language'] = lang
    }

    return apiClient.get(`${json.api.suggested_products}/${id}?page=${page}`)
  },
  userLogin(params, lang = null) {
    if (lang) {
      apiClient.defaults.headers.common['Language'] = lang
    }

    return apiClient.post(json.api.login, params)
  },
  userRegistration(params, lang = null) {
    if (lang) {
      apiClient.defaults.headers.common['Language'] = lang
    }

    return apiClient.post(json.api.register, params)
  },
  userVerification(params, lang = null) {
    if (lang) {
      apiClient.defaults.headers.common['Language'] = lang
    }

    return apiClient.post(json.api.verify, params)
  },
  userForgotPassword(params, lang = null) {
    if (lang) {
      apiClient.defaults.headers.common['Language'] = lang
    }

    return apiClient.post(json.api.forgotPassword, params)
  },
  userUpdatePassword(params, lang = null) {
    if (lang) {
      apiClient.defaults.headers.common['Language'] = lang
    }

    return apiClient.post(json.api.updatePassword, params)
  },
  userAddressAll(params, bearer) {
    apiClient.defaults.headers.common['Authorization'] = bearer
    return apiClient.get(json.api.userAddressAll, {params: params})
  },
  userAddressAction(params, bearer) {
    apiClient.defaults.headers.common['Authorization'] = bearer
    return apiClient.post(json.api.userAddressAction, params)
  },
  userAddressDelete(id, bearer, params = null) {
    apiClient.defaults.headers.common['Authorization'] = bearer
    return apiClient.delete(`${json.api.userAddressDelete}/${id}`, {params: params})
  },
  userWishlistAll(params, bearer) {
    apiClient.defaults.headers.common['Authorization'] = bearer
    return apiClient.get(json.api.userWishlistAll, {params: params})
  },
  userWishlistAction(params, bearer) {
    apiClient.defaults.headers.common['Authorization'] = bearer
    return apiClient.post(json.api.userWishlistAction, params)
  },
  userVouchers(params, bearer, lang = null) {
    if (lang) {
      apiClient.defaults.headers.common['Language'] = lang
    }

    apiClient.defaults.headers.common['Authorization'] = bearer
    return apiClient.get(json.api.userVouchers, {params: params})
  },
  updateProfile(params, bearer) {
    apiClient.defaults.headers.common['Authorization'] = bearer
    return apiClient.post(json.api.updateProfile, params)
  },
  updateUserPassword(params, bearer) {
    apiClient.defaults.headers.common['Authorization'] = bearer
    return apiClient.post(json.api.updateUserPassword, params)
  },

  userLogout() {
    return apiClient.get(json.api.logout)
  },
  cartByUser(bearer, lang = null, params = null) {
    if (lang) {
      apiClient.defaults.headers.common['Language'] = lang
    }

    apiClient.defaults.headers.common['Authorization'] = bearer
    return apiClient.get(`${json.api.cartByUser}`, {params: params})
  },
  cartAction(params, bearer) {
    apiClient.defaults.headers.common['Authorization'] = bearer
    return apiClient.post(json.api.cartAction, params)
  },
  buyNow(params, bearer) {
    apiClient.defaults.headers.common['Authorization'] = bearer

    return apiClient.post(json.api.buyNow, params)
  },
  cartDelete(cartId, bearer) {
    apiClient.defaults.headers.common['Authorization'] = bearer
    return apiClient.delete(`${json.api.cartDelete}/${cartId}`)
  },
  cartChanged(params, bearer) {
    apiClient.defaults.headers.common['Authorization'] = bearer
    return apiClient.post(json.api.cartChanged, params)
  },
  updateCartShipping(params, bearer) {
    apiClient.defaults.headers.common['Authorization'] = bearer
    return apiClient.post(json.api.updateCartShipping, params)
  },
  addressByUser(userId, bearer) {
    apiClient.defaults.headers.common['Authorization'] = bearer
    return apiClient.get(`${json.api.addressByUser}/${userId}`)
  },
  addressAction(params, bearer) {
    apiClient.defaults.headers.common['Authorization'] = bearer
    return apiClient.post(`${json.api.addressAction}/${params.id}`, params)
  },
  addressDelete(addressId, bearer) {
    apiClient.defaults.headers.common['Authorization'] = bearer
    return apiClient.delete(`${json.api.addressDelete}/${addressId}`)
  },
  orderByUser(params, bearer, lang = null) {
    if (lang) {
      apiClient.defaults.headers.common['Language'] = lang
    }
    if (bearer) {
      apiClient.defaults.headers.common['Authorization'] = bearer
    }
    return apiClient.post(`${json.api.orderByUser}`, params)
  },
  orderAction(params, bearer, lang = null) {
    if (lang) {
      apiClient.defaults.headers.common['Language'] = lang
    }

    apiClient.defaults.headers.common['Authorization'] = bearer
    return apiClient.post(`${json.api.orderAction}`, params)
  },
  paymentDone(params, bearer, lang = null) {
    if (lang) {
      apiClient.defaults.headers.common['Language'] = lang
    }

    apiClient.defaults.headers.common['Authorization'] = bearer
    return apiClient.post(`${json.api.paymentDone}`, params)
  },
  cancelOrder(params, bearer, lang = null) {
    if (lang) {
      apiClient.defaults.headers.common['Language'] = lang
    }

    if (bearer) {
      apiClient.defaults.headers.common['Authorization'] = bearer
    }

    return apiClient.post(`${json.api.cancelOrder}`, params)
  },
  cancellationFind(params, bearer, lang = null) {
    if (lang) {
      apiClient.defaults.headers.common['Language'] = lang
    }

    apiClient.defaults.headers.common['Authorization'] = bearer
    return apiClient.get(`${json.api.cancellationFind}/${params.id}`, {params: params})
  },
  ratingReviewAction(params, bearer, lang = null) {
    if (lang) {
      apiClient.defaults.headers.common['Language'] = lang
    }

    apiClient.defaults.headers.common['Authorization'] = bearer
    return apiClient.post(`${json.api.ratingReviewAction}`, params)
  },
  ratingReviewFind(params, bearer, lang = null) {
    if (lang) {
      apiClient.defaults.headers.common['Language'] = lang
    }

    apiClient.defaults.headers.common['Authorization'] = bearer
    return apiClient.get(`${json.api.ratingReviewFind}/${params.id}`, {params: params})
  },
  voucherValidity(params, bearer, lang = null) {
    if (lang) {
      apiClient.defaults.headers.common['Language'] = lang
    }

    apiClient.defaults.headers.common['Authorization'] = bearer
    return apiClient.post(`${json.api.voucherValidity}`, params)
  },
  contactUs(params) {
    return apiClient.post(json.api.contact, params)
  },
  sendOrderEmail(params, bearer, lang = null) {
    if (lang) {
      apiClient.defaults.headers.common['Language'] = lang
    }

    apiClient.defaults.headers.common['Authorization'] = bearer
    return apiClient.get(`${json.api.sendOrderEmail}/${params.id}`, {params: params})
  },
  ssrGetRequest(params, api, bearer = null, lang = null) {
    if (lang) {
      apiClient.defaults.headers['Language'] = lang
    } else {
      if (apiClient.defaults.headers?.Language) {
        delete apiClient.defaults.headers['Language']
      }
    }

    if (bearer) {
      apiClient.defaults.headers['Authorization'] = bearer
    }
    return apiClient.get(json.api[api], {params: params})
  },
  getRequest(params, api, bearer = null, lang = null) {
    if (lang) {
      apiClient.defaults.headers['Language'] = lang
    } else {
      if (apiClient.defaults.headers?.Language) {
        delete apiClient.defaults.headers['Language']
      }
    }

    if (bearer) {
      apiClient.defaults.headers.common['Authorization'] = bearer
    }
    return apiClient.get(json.api[api], {params: params})
  },
  deleteRequest(api, bearer, lang = null) {
    if (lang) {
      apiClient.defaults.headers['Language'] = lang
    } else {
      if (apiClient.defaults.headers?.Language) {
        delete apiClient.defaults.headers['Language']
      }
    }

    if (bearer) {
      apiClient.defaults.headers.common['Authorization'] = bearer
    }
    return apiClient.delete(json.api[api])
  },

  postRequest(params, api, bearer = null, lang = null) {
    if (lang) {
      apiClient.defaults.headers['Language'] = lang
    } else {
      if (apiClient.defaults.headers?.Language) {
        delete apiClient.defaults.headers['Language']
      }
    }

    if (bearer) {
      apiClient.defaults.headers.common['Authorization'] = bearer
    }
    return apiClient.post(json.api[api], params)
  },
}
