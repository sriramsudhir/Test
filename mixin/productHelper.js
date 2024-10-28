export default {
  data() {
    return {
      ajaxingWishlist: false,
      priceType: {
        flat: 1,
        percent: 2
      }
    }
  },
  computed: {
  },
  methods: {
    async wishListAction(){
      if(!this.$auth?.loggedIn){
        this.$auth.redirect('login')
        return
      }
      this.ajaxingWishlist = true

      const data = await this.userWishlistAction({
        product_id: this.product.id
      })
      this.ajaxingWishlist = false
      if(data?.status === 200){
        this.setToastMessage(data.message)
      }else{
        this.setToastError(data.data.form.join(', '))
      }
    },
    refundable(product){
      return (parseInt(product?.refundable) === 1)
    },
    warranty(product){
      return (parseInt(product?.warranty) === 1) ? this.$t('productHelper.available') : this.$t('productHelper.notAvailable')
    },
    getPriceType(item){
      if(parseInt(item.type) === this.priceType.flat){

        return this.priceFormat(this.currencyPosition, this.currencyIcon, item.price, this.setting)

      }else {
        return item.price + '%'
      }
    }
  }
}
