import {mapGetters, mapActions} from 'vuex'

export default {
  data() {
    return {
      ajaxingWishlist: false,
      ajaxing: false,
      buyingNow: false,
      quantity: 1,
      cartError: {
        attribute: null,
        quantity: null,
      },
    }
  },
  computed:{
    wishListed() {
      return this.$auth?.user?.id && this.product?.wishlisted
    },
    maxQuantity() {
      return parseInt(this.productInventory?.quantity || 0)
    },
    isInStock() {
      if (this.inventory) {
        return this.inventory.quantity > 0
      }
      return this.product?.in_stock
    },
    ...mapGetters('common', ['currencyIcon', 'setting']),
    ...mapGetters('language', ['langCode']),
  },
  methods: {

    emitCartError() {

      this.$emit('cart-error', this.cartError)

    },
    async buyNowProduct() {
      return new Promise(async resolve => {

        this.buyingNow = true

        await this.buyNow({
          payload: {
            user_token: await this.getUserToken(),
            product_id: this.product.id,
            inventory_id: this.productInventory.id,
            quantity: this.quantity
          },
          lang: this.langCode
        }).then(() => {
          this.buyingNow = false
          resolve()
        })
      })
    },
    async addToCart(isBuyNow = false) {
      if (!this.setting?.guest_checkout) {
        if (!this.$auth.loggedIn) {
          this.$auth.redirect('login')
          return false
        }
      }

      this.cartError = {
        attribute: null,
        quantity: null
      }

      if (!this.isInStock) {
        this.setToastError(this.$t('detailRight.outOfStock'))
        return false
      }

      if (Object.values(this.productInventory).length === 0) {
        const attr = this.product?.attribute.map(i=>{
          return i?.title
        })
        this.cartError.attribute = this.$t('detailRight.requiredAttributes')
        if(attr.length){
          this.cartError.attribute += `(${attr.join(' / ')})`
        }
        this.emitCartError()
        return false
      }

      if (this.productInventory.quantity < this.quantity) {

        this.cartError.quantity = this.$t('detailRight.exceedsInventory')
        this.emitCartError()
        return false
      }
      if (isBuyNow) {
        await this.buyNowProduct()
          .then(() => {

            setTimeout(() => {
              this.$router.push({path: '/shipping'})
            }, 300)

          })

      } else {
        await this.cartAdd()
      }
    },
    async cartAdd() {
      this.ajaxing = true
      await this.cartAction({
        payload: {
          user_token: await this.getUserToken(),
          apiVal: {
            user_token: await this.getUserToken(),
            product_id: this.product.id,
            inventory_id: this.productInventory?.id,
            quantity: this.quantity
          },
          isBundle: !!this.product?.bundle_deal,
          storeVal: {
            product: {
              id: this.product.id,
              title: this.product.title,
              offered: this.product.offered,
              selling: this.product.selling,
              image: this.product.image,
              shipping_rule: this.product.shipping_rule
            },
            inventory: this.productInventory,
            quantity: this.quantity,
            selected: 1,
            offered: 0,
            bundle_deal: this.product?.bundle_deal,
            shipping_type: 1
          }
        },
        lang: this.langCode

      })
      this.ajaxing = false
    },
    ...mapActions('cart', ['cartAction', 'buyNow']),
    ...mapActions('wishlist', ['userWishlistAction']),
    ...mapActions('common', ['setToastMessage', 'setToastError']),
    ...mapActions('user', ['getUserToken']),
  }
}
