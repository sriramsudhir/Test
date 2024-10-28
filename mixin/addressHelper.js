
export default {
  data() {
    return {
      fetchingAddressData: false
    }
  },
  methods: {
    async addressAction() {
      if (this.addressData.email && this.addressData.city && this.addressData.phone && this.addressData.name &&
        this.addressData.zip && this.addressData.country && this.addressData.address_1) {

        this.submittingAddressData = true
        const data = await this.userAddressAction({
          ...this.addressData,
          ...{
            user_token: await this.getUserToken()
          }
        })

        if(data?.status === 200){
          this.hasAddressErrors = false
          this.setToastMessage(data.message)

        } else if(data?.status === 201) {
          this.setToastError(data.data?.form?.join(', '))

        } else {
          this.hasError(data)
        }
        this.submittingAddressData = false

      } else {
        this.hasAddressErrors = true
      }
    },
    async deleting(address) {
      if (confirm(this.$t('cartProductTile.deleteAlert'))) {
        this.ajaxDeleting = address.id
        const data = await this.userAddressDelete({
          id: address.id,
          params: {
            user_token: await this.getUserToken()
          }
        })

        if(data?.status === 200){
          this.setToastMessage(data.message)
          await this.fetchingData()
        }else {
          this.setToastError(data.data.form.join(', '))
        }
        this.ajaxDeleting = 0
      }
    },
    formatAddress(obj) {
      let addArr = []

      addArr.push(obj.address_1)
      if (obj.address_2) {
        addArr.push(obj.address_2)
      }
      addArr.push(obj.city + '-' + obj.zip)

      if (this.countryList[obj.country]) {
        const country = this.countryList[obj.country]

        if (country.states[obj.state]) {
          addArr.push(country.states[obj.state].name)
        }

        addArr.push(country.name)
      }


      let addressStr = addArr.filter(function (el) {
        return el != null;
      }).join(', ')

      return addressStr
    },
    async fetchingData() {
      this.fetchingAddressData = true
      setTimeout(async () => {

        try {
          this.settingRouteParam()

          const data = await this.userAddressAll({
            time_zone: this.timeZone,
            order_by: this.orderBy,
            type: this.orderByType,
            page: this.page,
            user_token: await this.getUserToken(),
            q: this.search
          })
          if (data?.status !== 200) {
            this.hasError(data)
          }
        } catch (e) {
          return this.$nuxt.error(e)
        }
        this.fetchingAddressData = false
      }, 100)
    }
    }
}
