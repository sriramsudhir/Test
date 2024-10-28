<template>
  <account-layout
    active-route="addresses"
    @clicked-addresses="loadData"
    class="mb-5"
  >
    <template v-slot:rightArea>
        <div>
          <transition
            name="fade"
            mode="out-in"
          >
            <address-popup
              v-if="addressPopup"
              :address="editingAddress"
              @close="closingPopup"
            />
          </transition>
          <button
            aria-label="submit"
            class="primary-btn plr-20 mb-15"
            @click.prevent="adding"
          >
            {{ $t('addresses.addAddress') }}
          </button>
          <user-address
            ref="userAddress"
            @editing="editing"
          />
        </div>
    </template>
  </account-layout>
</template>
<script>
  import {mapGetters, mapActions} from 'vuex'
  import util from '~/mixin/util'
  import LazyImage from '~/components/LazyImage'
  import AddressPopup from '~/components/AddressPopup'
  import UserAddress from '~/components/UserAddress'
  import AccountLayout from '~/components/AccountLayout'

  import addressHelper from '~/mixin/addressHelper'
  import productHelper from '~/mixin/productHelper'

  import global from '~/mixin/global'

  export default {
    middleware: ['common-middleware', 'auth'],
    head() {
      return {
        title: this.$t('date.addr'),
        meta: []
      }
    },
    data() {
      return {
        editingAddress: null,
        addressPopup: false,
        deactivate: true
      }
    },
    watch: {
    },
    components: {
      LazyImage,
      AddressPopup,
      AccountLayout,
      UserAddress
    },
    mixins: [util, productHelper, addressHelper, global],
    computed: {
      ...mapGetters('common', ['currencyIcon', 'setting'])
    },
    methods: {
      loadData() {
        this.$refs.userAddress.loadData()
      },
      closingPopup() {
        this.addressPopup = false
      },
      adding() {
        this.addressPopup = true
        this.editingAddress = null
      },
      editing(value) {
        this.addressPopup = true
        this.editingAddress = value
      },
      ...mapActions('common', ['fetchLocation', 'setToastMessage', 'setToastError']),
    },
    async mounted() {
    },
  }
</script>

<style>

</style>
