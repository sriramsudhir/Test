<template>
  <client-only>
    <div class="container-fluid mtb-20 mtb-sm-15">

      <div class="product-detail checkout-detail">
        <div
          class="area detail-left pt-10 plr-20 plr-sm-15 pb-20 pb-sm-15 mr-20 mr-sm mb-sm-15"
        >
          <h5
            class="b-b pb-10 mb-15 bold"
          >
            {{ $t('checkout.selectPayment') }}
          </h5>
          <payment-gateways
            ref="paymentGateways"
            :total-price="totalPrice"
            :voucher="voucherResult"
          />
        </div>
        <checkout-right
          route-link="checkout"
          :checked-product="checkedProduct"
          :has-shipping="true"
          :voucher-result="voucherResult"
          :hide-btn="true"
          @calculated-price="calculatedPrice"
        >
          <template v-slot:checkout>
            <div :class="{invalid: !!voucherError}">
              <form
                class="mt-15 btn-input"
              >
                <input
                  class="pl-15 pr-80"
                  :placeholder="$t('checkout.voucherCode')"
                  type="text"
                  v-model="voucher">

                <ajax-button
                  class="primary-btn plr-15"
                  type="button"
                  :fetching-data="submitting"
                  loading-text=""
                  :disabled="!voucher || !!voucherError || !!voucherResult"
                  :text="$t('checkout.apply')"
                  @clicked="checkVoucher"
                />
              </form>
            </div>
            <span
              v-if="voucherError"
              class="error"
            >
            {{ voucherError }}
          </span>
          </template>
        </checkout-right>
      </div>
    </div>
  </client-only>
</template>
<script>
  import CheckoutRight from '~/components/CheckoutRight'
  import StripePayment from '~/components/StripePayment'
  import RazorpayPayment from '~/components/RazorpayPayment'
  import util from '~/mixin/util'
  import {mapGetters, mapActions} from 'vuex'
  import productHelper from "~/mixin/productHelper"
  import productPriceHelper from "~/mixin/productPriceHelper"
  import paymentHelper from '~/mixin/paymentHelper'
  import PaymentGateways from "~/components/PaymentGateways";
  import AjaxButton from "~/components/AjaxButton";
  import global from '~/mixin/global'

  export default {
    middleware: ['common-middleware'],
    head() {
      return {
        link: [
          {
            rel: 'preload',
            as: 'script',
            href:
              `https://www.paypal.com/sdk/js?client-id=${this.paymentGateway?.paypal_key}&components=buttons,marks&disable-funding=paylater,card`
          },
          {
            rel: 'preload',
            as: 'script',
            href: 'https://checkout.flutterwave.com/v3.js'
          },
        ],
      }
    },
    data() {
      return {
        loading: false,
        paypaLoaded: false,
        voucher: '',
        voucherError: null,
        voucherResult: null,
        submitting: false,
        placingOrder: false,
        cartPrice: 0,
        checkedProductQty: 0
      }
    },
    watch: {
      voucher() {
        this.voucherResult = null
        this.voucherError = null
      }
    },
    components: {
      AjaxButton,
      PaymentGateways,
      RazorpayPayment,
      StripePayment,
      CheckoutRight
    },
    mixins: [util, productHelper, paymentHelper, productPriceHelper, global],
    computed: {
      noPaymentMethod() {
        return parseInt(this.paymentGateway?.card_payment) !== this.status.PUBLIC &&
          parseInt(this.paymentGateway?.cash_on_delivery) !== this.status.PUBLIC
      },
      productPrice() {
        return this.cartPrice.totalPriceWithOffer + this.cartPrice.shippingPrice + this.cartPrice.tax
      },
      totalPrice() {
        if (this.productPrice) {
          return this.productPrice - this.cartPrice.voucher
        }
        return 0
      },
      checkedProduct() {
        return this.cartProducts.filter(obj => {
          return parseInt(obj.selected) === 1
        })
      },
      ...mapGetters('language', ['langCode']),
      ...mapGetters('common', ['currencyIcon', 'setting', 'currency', 'paymentGateway']),
      ...mapGetters('cart', ['cartProducts']),
    },
    methods: {
      async checkVoucher() {
        this.submitting = true
        const res = await this.voucherValidity({
          payload: {
            voucher: this.voucher,
            user_token: await this.getUserToken(),
            price: this.cartPrice?.totalPriceWithOffer
          },
          lang: this.langCode
        })
        this.submitting = false
        if (res?.status === 201) {
          this.voucherError = res.data.form[0]
        } else {
          this.voucherResult = res.data
        }
      },
      calculatedPrice(evt) {
        this.cartPrice = evt
      },

      ...mapActions('user', ['userAddressAll', 'userAddressDelete', 'getUserToken']),
      ...mapActions('common', ['setToastMessage', 'setToastError']),
      ...mapActions('order', ['orderAction', 'voucherValidity', 'sendOrderEmail', 'paymentDone']),
      ...mapActions('cart', ['getCartByUser', 'subtractCartProductCount', 'emptyCartProduct']),
    },
    async asyncData({store, $auth, error}) {
      try {
        if(!store.state?.common?.setting?.guest_checkout) {
          if (!$auth.loggedIn) {
            $auth.redirect('login')
            return false
          }
        }
        if(!store.state.common.paymentGateway){
          const data = await store.dispatch('common/getRequest', {
            params: {},
            api: 'paymentGateway'
          })
          store.commit('common/SET_PAYMENT_GATEWAY', data.data)
        }
      } catch (e) {
        error(e)
      }
    },

    async mounted() {
      this.orderId = ''
      this.voucherError = null
      this.voucherResult = null
      try {
        if (this.cartProducts.length === 0) {
          await this.getCartByUser({
            lang: this.langCode,
            params: {
              user_token: await this.getUserToken()
            }
          })
        }
      } catch (e) {
        return this.$nuxt.error(e)
      }
    },
  }
</script>
