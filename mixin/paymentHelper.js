export default {
  data() {
    return {}
  },
  mounted() {
  },
  methods: {
    phpEncryption(data) {
      data = JSON.stringify(data)
      let key = this.CryptoJS.enc.Hex.parse("0123456470abcdef0123456789abcdef");
      let iv = this.CryptoJS.enc.Hex.parse("abcdef1876343516abcdef9876543210");
      return this.CryptoJS.AES.encrypt(data, key, {iv: iv, padding: this.CryptoJS.pad.ZeroPadding}).toString()
    },
    async paymentDoneFn(orderId, paymentToken, orderMethod) {

      const data = await this.paymentDone({
        lang: this.langCode,
        payload: {
          data: this.phpEncryption({
            id: orderId,
            payment_token: paymentToken,
            order_method: orderMethod,
            user_token: await this.getUserToken()
          })
        }
      })

      this.submitting = false
      if (data?.status === 200) {
        this.$emit('success', orderId)
      } else {
        this.errorText = data.data.form.join(', ')
        this.$emit('error', data.data.form.join(', '))

      }
      return data

    },
  }
}
