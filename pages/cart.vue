<template>
  <client-only>
    <div class="container-fluid mtb-20 mtb-sm-15">
      <div class="product-detail checkout-detail">
        <div
          class="detail-left ptb-10 plr-20 plr-sm-15 mr-sm area mr-20 mb-sm-15"
        >
          <div class="b-b pb-10 mb-10 flex sided">
            <h5 class="bold">
              {{ $t('cart.shoppingCart') }}
            </h5>
            <p v-if="!checked.length">
              {{ $t('cart.noSelected') }}
              <button
                aria-label="submit"
                class="link ml-10 f-9"
                @click.prevent="selectAllItems"
              >
                {{ $t('cart.selectItems') }}
              </button>
            </p>
            <p v-else>
              <button
                aria-label="submit"
                class="link f-9"
                @click.prevent="deselectAllItems"
              >
                {{ $t('cart.deselectItems') }}
              </button>
            </p>
          </div>

          <cart-list
            :cart-products="cartProducts"
            :ajaxing="ajaxing"
            :checked="checked"
          />
          <div class="flex sided pb-5">
            <h5 class="price">
              {{ $t('cart.subtotal', { items: cartPrice.totalItems }) }}
            </h5>
            <h4 class="price">
              <price-format
                :price="cartPrice.totalPriceWithOffer"
              />
            </h4>
          </div>
        </div>

        <checkout-right
          :disabled="preventGoing"
          :checked-product="checkedProduct"
          @calculated-price="cartPrice = $event"
          @go-next="goToAddress"
        />


      </div>
    </div>
  </client-only>
</template>
<script>
  import {mapGetters, mapActions} from 'vuex'
  import AjaxButton from '~/components/AjaxButton'
  import CheckoutRight from '~/components/CheckoutRight'
  import CartList from '~/components/CartList'
  import util from '~/mixin/util'
  import productHelper from "~/mixin/productHelper";
  import PriceFormat from "~/components/PriceFormat";
  import global from '~/mixin/global'

  export default {
    middleware: ['common-middleware'],
    data() {
      return {
        preventGoing: true,
        checked: [],
        ajaxing: false,
        isMounting: false,
        hasBundle: false,
        cartPrice: {
          totalItems: 0,
          totalPriceWithOffer: 0,
          totalPrice: 0,
        }
      }
    },
    watch: {},
    components: {
      PriceFormat,
      AjaxButton,
      CheckoutRight,
      CartList
    },
    mixins: [util, productHelper, global],
    computed: {
      checkedProduct() {
        this.checked = []
        let checkedP = []
        this.cartProducts.forEach(obj => {
          if (parseInt(obj.selected) === 1) {
            this.checked.push(obj.id)
            checkedP.push(obj)
          }
        })
        this.preventGoing = checkedP.length === 0
        return checkedP
      },
      cartCount() {
        return this.$auth?.user?.cart_count
      },
      ...mapGetters('language', ['langCode']),
      ...mapGetters('common', ['currencyIcon', 'setting']),
      ...mapGetters('cart', ['cartProducts'])
    },
    methods: {
      goToAddress() {
        this.$router.push('/shipping')
      },
      async selectAllItems() {
        this.checked = []
        this.cartProducts.forEach((obj) => {
          this.checked.push(obj.id)
        })
        await this.cartChanged({
          payload: {
            checked: this.checked
          },
          lang: this.langCode
        })
        await this.cartChangedApi()
      },
      async deselectAllItems() {
        this.checked = []
        await this.cartChanged({
          payload: {
            checked: this.checked
          },
          lang: this.langCode
        })
      },
      async cartChangedApi(bundleDeal = false) {
        await this.cartChanged({
          payload: {
            checked: this.checked,
            unchecked: this.unchecked,
            isBundle: bundleDeal
          },
          lang: this.langCode
        })
      },
      settingChecked() {
        this.checkedProduct = []
        this.checked = []

        this.cartProducts.forEach(obj => {
          if (parseInt(obj.selected) === 1) {
            this.checked.push(obj.id)
            this.checkedProduct.push(obj)
          }
        })
      },
      async fetchingData() {
        this.ajaxing = true
        try {
          await this.getCartByUser({
            lang: this.langCode,
            params: {
              user_token: await this.getUserToken()
            }
          })
        } catch (e) {
          return this.$nuxt.error(e)
        }
        this.ajaxing = false
      },
      ...mapActions('common', ['fetchLocation']),
      ...mapActions('cart', ['getCartByUser', 'cartChanged']),
      ...mapActions('user', ['getUserToken'])
    },
    async asyncData({store, $auth, error}) {
      try {
        if(!store.state?.common?.setting?.guest_checkout) {
          if (!$auth.loggedIn) {
            $auth.redirect('login')
            return false
          }
        }
      } catch (e) {
        error(e)
      }
    },
    async mounted() {
      await this.fetchingData()
    }
  }
</script>

<style>

</style>
