export default {
  data() {
    return {
    }
  },
  computed: {
  },
  methods: {
    async addToCompare(){
      if(!this.$auth?.loggedIn){
        this.$auth.redirect('login')
        return
      }
      this.ajaxingCompare = true

      const data = await this.postRequest({
        params: {product_id: this.product.id},
        api: 'compareListAction',
        requiredToken: true
      })
      this.ajaxingCompare = false
      if (data?.status === 200){
        if(!data.data){
          this.$emit('removed')
        }
        this.setToastMessage(data.message)
      }else {
        this.setToastError(data.data.form.join(', '))
      }
    },
  }
}
