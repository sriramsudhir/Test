<template>
  <client-only>
  <account-layout
    @clicked-vouchers="loadData"
    active-route="vouchers"
    class="mb-5"
  >
    <template v-slot:rightArea>
      <vouchers
        ref="voucherPagination"
      />
    </template>
  </account-layout>
  </client-only>
</template>

<script>

  import {mapGetters, mapActions} from 'vuex'
  import util from '~/mixin/util'
  import LazyImage from '~/components/LazyImage'
  import RatePopup from '~/components/RatePopup'
  import AccountLayout from '~/components/AccountLayout'
  import Pagination from '~/components/Pagination'
  import global from '~/mixin/global'

  export default {
    middleware: ['common-middleware', 'auth'],
    head() {
      return {
        title: 'Vouchers',
        meta: []
      }
    },
    data() {
      return {
      }
    },
    watch: {
    },
    components: {
      LazyImage,
      RatePopup,
      AccountLayout,
      Pagination
    },
    mixins: [util, global],
    computed: {
      ...mapGetters('common', ['currencyIcon', 'setting'])
    },
    methods: {
      async loadData() {
        setTimeout(()=>{
          this.$refs.voucherPagination.loadData()
        },100)
      },
      ...mapActions('user', ['emptyVoucher']),
    },
    async mounted() {
      this.emptyVoucher()

    },
  }
</script>

<style>

</style>
