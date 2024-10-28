<template>
  <div class="mb-10 flex start wrap">
    <div class="ck-button">
      <label>
        <input
          @change="cancelledChanged"
          hidden
          type="checkbox"
          name="orders-variation"
          v-model="cancelled"
        >
        <span>{{ $t('orderTabbing.cancelled') }}</span>
      </label>
    </div>
    <div class="ck-button">
      <label>
        <input
          @change="codChanged"
          hidden
          type="checkbox"
          name="orders-variation"
          v-model="cashOnDelivery"
        >
        <span>{{ $t('orderTabbing.cod') }}</span>
      </label>
    </div>
    <div class="ck-button">
      <label>
        <input
          @change="cardPaymentChanged"
          hidden
          type="checkbox"
          name="orders-variation"
          v-model="cardPayment"
        >
        <span>{{ $t('orderTabbing.cardPayment') }}</span>
      </label>
    </div>
    <div class="ck-button">
      <label>
        <input
          @change="paidChanged"
          hidden
          type="checkbox"
          name="orders-variation"
          v-model="paid"
        >
        <span>{{ $t('orderTabbing.paid') }}</span>
      </label>
    </div>
    <div class="ck-button">
      <label>
        <input
          @change="unpaidChanged"
          hidden
          type="checkbox"
          name="orders-variation"
          v-model="unpaid"
        >
        <span>{{ $t('orderTabbing.unPaid') }}</span>
      </label>
    </div>
  </div>
</template>

<script>

  export default {
    name: 'OrderTabbing',
    components: {},
    directives: {},
    props: {
    },
    computed: {
      paidOrders() {
        return this.$route?.query?.paid || false
      },
      unpaidOrders() {
        return this.$route?.query?.unpaid || false
      },
      cardPaymentOrders() {
        return this.$route?.query?.cardPayment || false
      },
      cashOnDeliveryOrders() {
        return this.$route?.query?.cashOnDelivery || false
      },
      cancelledOrders() {
        return this.$route?.query?.cancelled || false
      },
    },
    data() {
      return {
        cashOnDelivery: false,
        cardPayment: false,
        cancelled: false,
        paid: false,
        unpaid: false,
      }
    },
    methods: {
      generateParam(){
        const param = {}
        if(this.cancelledOrders){
          param['cancelled'] = this.cancelledOrders ? 1 : 0
        }

        if(this.paidOrders){
          param['paid'] = this.paidOrders ? 1 : 0
        }

        if(this.unpaidOrders){
          param['unpaid'] = this.unpaidOrders ? 1 : 0
        }

        if(this.cardPaymentOrders){
          param['card_payment'] = this.cardPaymentOrders ? 1 : 0
        }

        if(this.cashOnDeliveryOrders){
          param['cash_on_delivery'] = this.cashOnDeliveryOrders ? 1 : 0
        }
        return param
      },
      updateRoute(key, value = null){
        this.$router.push({
          query: {
            ...this.$route.query,
            page: 1,
            orderBy: 'created_at',
            orderByType: 'desc',
            [key]: value,
          }
        })
        this.$emit('fetch-data', this.generateParam())
      },
      unpaidChanged(){
        if(this.unpaid){
          this.updateRoute('unpaid', this.unpaid)
        }else{
          this.updateRoute('unpaid')
        }
      },
      cardPaymentChanged(){
        if(this.cardPayment){
          this.updateRoute('cardPayment', this.cardPayment)
        }else{
          this.updateRoute('cardPayment')
        }
      },
      codChanged(){
        if(this.cashOnDelivery){
          this.updateRoute('cashOnDelivery', this.cashOnDelivery)
        }else{
          this.updateRoute('cashOnDelivery')
        }
      },
      paidChanged(){
        if(this.paid){
          this.updateRoute('paid', this.paid)
        }else{
          this.updateRoute('paid')
        }
      },
      cancelledChanged(){
        if(this.cancelled){
          this.updateRoute('cancelled', this.cancelled)
        }else{
          this.updateRoute('cancelled')
        }
      },
      resetting(){
        this.cancelled = this.cancelledOrders
        this.paid = this.paidOrders
        this.unpaid = this.unpaidOrders
        this.cardPayment = this.cardPaymentOrders
        this.cashOnDelivery = this.cashOnDeliveryOrders
      }
    },
    mounted() {
      window.addEventListener('popstate', this.resetting)
      this.resetting()
    },
    destroyed() {
      window.removeEventListener('popstate', this.resetting)
    }
  }
</script>

