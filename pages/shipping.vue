<template>
  <div class="container-fluid mtb-20 mtb-sm-15">
    <div class="product-detail checkout-detail">

      <div
        class="detail-left p-20 p-sm-15 pb-10 area mr-20 mr-sm mb-sm-15 "
      >
        <h5 class="mb-20">{{ $t('date.dad') }}</h5>

        <div class="flex align-start gap-15 start">

          <transition
            name="fade"
            mode="out-in"
          >
            <div
              class="spinner-wrapper flex layer-white"
              v-if="loading"
            >
              <spinner
                :radius="100"
              />
            </div>
          </transition>

          <div class="address-wrapper">
            <user-address
              ref="shippingAddress"
              :has-radio="true"
              @editing="editAddress"
              @selected-address="selectedCurrentAddress = $event"
              @add-address="addressPopup = true"
            />
          </div>

          <form
            class="address-form"
            @submit.prevent="savingAddressData"
          >
            <pop-over
              v-if="addressPopup"
              :title="$t('filter.address')"
              @close="closeAddressPopup"
              elem-id="shipping-address-pop-over"
              :layer="true"
            >
              <template
                v-slot:content
              >
                <div class="flex gap-15">
                  <div
                    v-if="countryList"
                    class="input-wrap flex-1"
                  >
                    <label>
                      {{ $t('addressPopup.country') }}
                    </label>
                    <dropdown
                      :selected-key="addressData.country"
                      :options="countryList"
                      :position-fixed="false"
                      key-name="name"
                      :searching="true"
                      @clicked="selectCountry"
                    />
                  </div>

                  <div
                    class="input-wrap flex-1"
                    :class="{invalid: !emailValid && hasAddressErrors}"
                  >
                    <label>
                      {{ $t('addressPopup.email') }}
                    </label>
                    <div class="icon-input">
                      <i
                        class="icon email-icon"
                      />
                      <input
                        type="text"
                        :placeholder="$t('contact.your', { type: $t('contact.email') })"
                        v-model.trim="addressData.email"
                      >
                    </div>

                    <span
                      class="error"
                      v-if="!addressData.email && hasAddressErrors"
                    >
                      {{ $t('addressPopup.isRequired', {type: $t('addressPopup.email') }) }}
                    </span>
                    <span
                      class="error"
                      v-else-if="invalidEmail && hasAddressErrors"
                    >
                      {{ $t('contact.invalidEmail') }}
                    </span>
                  </div>
                </div>


                <div class="flex block-xxs gap-15">
                  <div
                    class="input-wrap flex-1"
                    :class="{invalid: !addressData.name && hasAddressErrors}"
                  >
                    <label>
                      {{ $t('addressPopup.name') }}
                    </label>
                    <input
                      type="text"
                      v-model="addressData.name"
                    />
                    <span
                      class="error"
                      v-if="!addressData.name && hasAddressErrors"
                    >
                    {{ $t('addressPopup.isRequired', {type: $t('addressPopup.name')}) }}
                  </span>
                  </div>

                  <div
                    v-if="phoneList"
                    class="input-wrap flex-1"
                    :class="{invalid: !numberValid && hasAddressErrors}"
                  >
                    <label>
                      {{ $t('addressPopup.phone') }}
                    </label>
                    <div class="input-text">
                  <span>
                    {{ phoneList[addressData.country] }}
                  </span>
                      <input
                        type="text"
                        v-model="addressData.phone"
                      />
                    </div>
                    <span
                      class="error"
                      v-if="!addressData.phone && hasAddressErrors"
                    >
                      {{ $t('addressPopup.isRequired', {type: $t('addressPopup.phone')}) }}
                    </span>

                    <span
                      class="error"
                      v-else-if="invalidNumber && hasAddressErrors"
                    >
                      {{ $t('invent.in') }}
                    </span>
                  </div>
                </div>

                <div
                  class="input-wrap"
                  :class="{invalid: !addressData.address_1 && hasAddressErrors}"
                >
                  <label>
                    {{ $t('addressPopup.address') }}
                  </label>
                  <input
                    class="mb-10"
                    type="text"
                    v-model="addressData.address_1"
                    :placeholder="$t('addressPopup.addressPlaceholder')"
                  />
                  <input
                    type="text"
                    v-model="addressData.address_2"
                    :placeholder="$t('addressPopup.address2Placeholder')"
                  />
                  <span
                    class="error"
                    v-if="!addressData.address_1 && hasAddressErrors"
                  >
                  {{ $t('addressPopup.isRequired', {type: $t('addressPopup.address')}) }}
                </span>
                </div>

                <div class="flex block-xxs gap-15 sided">
                  <div
                    class="input-wrap"
                    :class="{invalid: !addressData.city && hasAddressErrors}"
                  >
                    <label>
                      {{ $t('addressPopup.city') }}
                    </label>
                    <input
                      type="text"
                      v-model="addressData.city"
                    />
                    <span
                      class="error"
                      v-if="!addressData.city && hasAddressErrors"
                    >
                     {{ $t('addressPopup.isRequired', {type: $t('addressPopup.city')}) }}
                  </span>
                  </div>

                  <div
                    class="input-wrap"
                    :class="{invalid: !addressData.zip && hasAddressErrors}"
                  >
                    <label>
                      {{ $t('addressPopup.zipCode') }}
                    </label>
                    <input
                      type="text"
                      v-model="addressData.zip"
                    />
                    <span
                      class="error"
                      v-if="!addressData.zip && hasAddressErrors"
                    >
                    {{ $t('addressPopup.isRequired', {type: $t('addressPopup.zipCode')}) }}
                  </span>
                  </div>

                  <div
                    v-if="Object.keys(states).length"
                    class="input-wrap"
                  >
                    <label>
                      {{ $t('addressPopup.state') }}
                    </label>
                    <dropdown
                      :selected-key="addressData.state"
                      position="right"
                      :position-fixed="false"
                      :options="states"
                      key-name="name"
                      @clicked="selectState"
                    />
                  </div>
                </div>

                <div class="input-wrap mb-0">
                  <label>
                    {{ $t('shipping.instruction') }}
                  </label>
                  <textarea
                    v-model="addressData.delivery_instruction"
                  />
                </div>

              </template>

              <template v-slot:pop-footer>
                <div class="flex sided mlr-0 gap-10">
                  <button
                    aria-label="submit"
                    class="outline-btn plr-30 plr-sm-15"
                    @click.prevent="clearData"
                  >
                    {{ $t('addressPopup.cancel') }}
                  </button>
                  <ajax-button
                    class="primary-btn plr-30 plr-sm-15"
                    :fetching-data="submittingAddressData"
                    :loading-text="$t('addressPopup.saving')"
                    :text=" $t('addressPopup.thisAddress', {type: editing > 0 ? $t('addressPopup.update') : $t('addressPopup.save')})"
                  />
                </div>
              </template>

            </pop-over>

          </form>
        </div>


        <div v-if="selectedSippingPlace" class="pickup-addr">
          <h5 class="mt-30 mb-10">{{ $t('date.pa') }}</h5>
          <div class="flex start">
            <p class="success-msg" v-html="selectedSippingPlace"/>
          </div>

        </div>

        <div class="mt-30">
          <h5 class="mb-10">{{ $t('date.os') }}</h5>


          <cart-list
            :error-from-api="errorFromApi"
            :cart-products="checkedProduct"
            :cart-shipping="cartShipping"
            :checked="checked"
            :current-addresses="currentAddresses"
            :is-shipping="true"
            :address="selectedCurrentAddress"
            @shipping-changed="shippingChanged"
            @cart-changed="cartChanged"
            @current-shipping="currentShipping"
          />
        </div>
      </div>

      <checkout-right
        route-link="checkout"
        :checked-product="checkedProduct"
        :btn-text="$t('date.ptp')"
        @calculated-price="priceCalculated"
        :submitting="checkingOut"
        :disabled="fetchingAddressData || Object.keys(cartShipping).length === 0 || !selectedCurrentAddress"
        @go-next="goToCheckout"
      />
    </div>

  </div>
</template>
<script>
  import CartList from '~/components/CartList'
  import AjaxButton from '~/components/AjaxButton'
  import Dropdown from '~/components/Dropdown'
  import PopOver from '~/components/PopOver'
  import CheckoutRight from '~/components/CheckoutRight'
  import util from '~/mixin/util'
  import {mapGetters, mapActions} from 'vuex'
  import UserAddress from '~/components/UserAddress'
  import addressHelper from '~/mixin/addressHelper'
  import validation from "~/mixin/validation"
  import Spinner from "~/components/Spinner"
  import global from '~/mixin/global'

  export default {
    middleware: ['common-middleware'],
    data() {
      return {
        addressPopup: false,
        cartShipping: {},
        checked: [],
        cartPrice: {
          totalItems: 0,
          totalPriceWithOffer: 0,
          totalPrice: 0,
        },
        cartPopOver: false,
        editing: 0,
        checkingOut: false,
        states: {},
        loading: false,
        checkedProduct: [],
        singleShippingCart: {},
        hasAddressErrors: false,
        addressData: {
          id: '',
          name: '',
          phone: '',
          city: '',
          country: '',
          state: '',
          zip: '',
          address_1: '',
          address_2: '',
          delivery_instruction: ''
        },
        submittingAddressData: false,
        selectedCurrentAddress: null,
        errorFromApi: null
      }
    },
    watch: {
      profile() {
        this.addressData.name = this.profile.name
        this.addressData.email = this.profile.email
      },
      location() {
        this.settingCountry()
      },
    },
    components: {
      Spinner,
      CheckoutRight,
      Dropdown,
      AjaxButton,
      CartList,
      PopOver,
      UserAddress
    },
    mixins: [util, addressHelper, validation, global],
    computed: {
      invalidNumber() {
        return !this.isValidNumber(this.addressData?.phone)
      },
      numberValid() {
        return this.addressData.phone && !this.invalidNumber
      },
      selectedSippingPlace(){
        const cartShippingValues = Object.values(this.cartShipping)
        if(cartShippingValues?.length) {

          const sp = cartShippingValues[0]?.shipping_place

          if(!sp?.pickup_point){
            return null
          }

          const addrArr = [sp.pickup_address_line_1, sp.pickup_address_line_2,
            sp.pickup_zip, sp.pickup_state, sp.pickup_city, sp.pickup_country]

          let addr = addrArr.filter(i => i).join(', ')

          if(sp.pickup_phone) {
            addr = `${addr}, <span class="block">${this.$t('date.tl')}: ${sp.pickup_phone}</span>`
          }
          return  addr
        }
        return null
      },

      invalidEmail() {
        return !this.isValidEmail(this.addressData.email)
      },
      emailValid() {
        return this.addressData.email && !this.invalidEmail
      },
      currentAddresses() {
        return this.allAddress?.data
      },
      ...mapGetters('resource', ['countryList', 'phoneList']),
      ...mapGetters('language', ['langCode']),
      ...mapGetters('user', ['allAddress', 'profile']),
      ...mapGetters('common', ['location']),
      ...mapGetters('cart', ['cartProducts']),
    },
    methods: {
      initAddress() {
        this.addressData = {
          id: '',
          email: '',
          name: '',
          phone: '',
          city: '',
          country: '',
          state: '',
          zip: '',
          address_1: '',
          address_2: '',
          delivery_instruction: ''
        }
      },
      loadData() {
        this.$refs.shippingAddress.loadData()
      },
      cartChanged(evt) {
        this.singleShippingCart = []

        if (evt) {
          this.getCheckedProducts()
        }
      },
      shippingChanged(evt) {
        this.cartShipping = evt
      },
      currentShipping({cart, shipping}) {
        if(this.cartShipping[cart] && shipping) {

          this.cartShipping[cart].shipping_place = shipping

          const sr = shipping?.shipping_rule

          if(sr?.single_price && (!this.singleShippingCart[sr?.id] || (this.singleShippingCart[sr?.id] === cart))) {

            this.singleShippingCart[sr?.id] = cart
            this.cartShipping[cart].single_shipping = true

          } else if(sr?.single_price && this.singleShippingCart[sr?.id]){

            this.cartShipping[cart].single_shipping = false
          }
        }
      },
      priceCalculated(evt) {
        this.cartPrice = evt
      },
      getCheckedProducts() {
        this.checked = []
        this.checkedProduct = []

        this.cartProducts.forEach(obj => {
          if (parseInt(obj.selected) === 1) {
            this.checked.push(obj.id)

            this.checkedProduct.push(obj)

            const sp = obj?.shipping_place ?? ''

            this.cartShipping = {
              ...this.cartShipping,
              ...{
                [obj.id]: {
                  cart: obj.id,
                  shipping_place: sp,
                  single_shipping: true,
                  shipping_type: obj.shipping_type || 1,
                }
              }
            }
          }
        })

      },
      async goToCheckout() {
        let unableToShip = false

        Object.values(this.cartShipping).forEach((obj) => {
          if (!obj.shipping_place) {
            unableToShip = true
            return
          }
        })
        if (unableToShip) {
          this.setToastError(this.$t('shipping.unableShipped'))
          return
        }
        if (!this.checkedProduct.length) {
          this.cartPopOver = false
          this.setToastError(this.$t('shipping.noProductSelected'))
          this.$router.push('/cart')
          return
        }
        try {
          this.checkingOut = true
          const data = await this.updateCartShipping({
            cart: this.cartShipping,
            user_token: await this.getUserToken(),
            selected_address: this.selectedCurrentAddress?.id
          })
          this.checkingOut = false
          if (data?.status === 200) {
            this.cartPopOver = false
            this.$router.push('/checkout')
          } else {
            if (data.data?.form) {
              this.setToastError(data.data?.form[0])
            } else if (data.data?.product) {
              this.errorFromApi = data.data?.product[0]
            }
          }
        } catch (e) {
          return this.$nuxt.error(e)
        }
      },
      goToShipping() {
        if (!this.currentAddresses.length) {
          this.setToastError(this.$t('shipping.addAddress'))
          return
        }
        if (!this.checkedProduct.length) {
          this.cartPopOver = false
          this.setToastError(this.$t('shipping.noProductSelected'))
          this.$router.push({path: 'cart'})
          return
        }

        this.$router.push({path: 'checkout'})
        //this.cartPopOver = true
      },
      clearData() {

        this.addressPopup = false

        this.initAddress()
        this.submittingAddressData = false
        this.editing = 0
        this.settingCountry()
        this.hasAddressErrors = false
      },
      async savingAddressData() {
        if (this.numberValid && this.emailValid) {
          await this.addressAction()
          if (!this.hasAddressErrors) {
            this.clearData()
          }
        } else {
          this.hasAddressErrors = true
        }
      },
      selectCountry(evt) {

        this.addressData = {...this.addressData, ...{country: evt.value?.code2}}
        this.states = evt.value?.states
        this.addressData.state = Object.keys(evt.value?.states).length ? Object.values(evt.value?.states)[0]?.code : ''
      },
      selectState(evt) {
        this.addressData.state = evt.value.code
      },
      settingCountry() {
        if (this.addressData) {
          if(this.location.countryCode && this.countryList[this.location.countryCode]){
            this.addressData.country = this.location.countryCode
          } else{

            this.addressData.country = Object.keys(this.countryList)[0]
          }

          this.states = this.addressData?.country ? this.countryList[this.addressData.country].states : ''
          this.addressData.state = this.location.region
        }
      },
      async deleting(address) {
        if (confirm(this.$t('deleteAlert.cartProductTile'))) {
          this.ajaxDeleting = address.id
          await this.addressDelete(address.id)
          this.ajaxDeleting = 0
        }
      },
      closeAddressPopup(){
        this.addressPopup = false
        this.addressData = {}

        this.addressData.country = this.location?.countryCode
        this.states = this.countryList[this.location?.countryCode]?.states
        this.addressData.state = this.location?.region
        this.addressData.email = this.profile?.email
      },
      editAddress(value) {
        this.addressPopup = true
        this.editing = value.id
        this.addressData = Object.assign({}, value)
        this.states = this.countryList[value.country].states
      },
      ...mapActions('resource', ['setCountryList', 'setPhoneList']),
      ...mapActions('user', ['userAddressAction', 'getUserToken']),
      ...mapActions('common', ['fetchLocation', 'setToastMessage', 'setToastError', 'getRequest']),
      ...mapActions('cart', ['getCartByUser', 'updateCartShipping'])
    },
    async mounted() {
      try {
        if (!this.countryList || !this.phoneList) {
          this.loading = true

          const {data} = await this.getRequest({
            params: null,
            lang: this.langCode,
            api: 'countriesPhones'
          })
          this.setCountryList(data?.countries)
          this.setPhoneList(data?.phones)
          this.loading = false
        }
        if (this.cartProducts.length === 0) {
          await this.getCartByUser({
            lang: this.langCode,
            params: {
              user_token: await this.getUserToken()
            }
          })
          this.getCheckedProducts()
        } else {
          if (this.cartProducts.length) {
            this.getCheckedProducts()
          }
        }
      } catch (e) {
        return this.$nuxt.error(e)
      }
      this.initAddress()
      this.$nextTick(() => {
        if (this.profile) {
          this.addressData.name = this.profile?.name
          this.addressData.email = this.profile?.email
        }
      })
      if (!this.addressData.country) {
        this.settingCountry()
      }
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
  }
</script>
