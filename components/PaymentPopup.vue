<template>
  <div>
    <pop-over
      v-if="!payNow"
      :title="$t('checkout.selectPayment')"
      elem-id="pay-now-pop-over"
      :layer="true"
      class="rating-popup payment-popup popup-top-auto"
      @close="$emit('close')"
    >
      <template v-slot:content>
        <payment-gateways
          page="order"
          :order="order"
          :total-price="parseFloat(amount)"
          @order-status="isOrderPlaced"
          @order-confirm="payNow = true"
          @close="$emit('close')"
        />
      </template>
    </pop-over>
  </div>
</template>
<script>
  import {mapGetters, mapActions} from 'vuex'
  import util from '~/mixin/util'
  import PopOver from "./PopOver";
  import RazorpayPayment from "./RazorpayPayment";
  import StripePayment from "./StripePayment";
  import PaymentGateways from "./PaymentGateways";

  export default {
    name: 'PaymentPopup',
    data() {
      return {
        payNow: false
      }
    },
    watch: {},
    props: {
      order: {
        type: Object,
        default(){
          return null
        }
      }
    },
    components: {
      PaymentGateways,
      StripePayment,
      RazorpayPayment,
      PopOver
    },
    computed: {
      userEmail() {
        return this.order?.userEmail || this.$auth?.user?.email
      },
      currencyData() {
        return this.order?.currency || this.currency
      },
      userName() {
        return this.order?.userName || this.$auth?.user?.name
      },
      razorpayPaymentToken() {
        return this.order?.payment_token || null
      },
      amount() {
        return this.order?.total_amount || 0
      },
      orderId() {
        return this.order?.id || null
      },
      ...mapGetters('common', ['currencyIcon', 'setting', 'paymentGateway'])
    },
    mixins: [util],
    methods: {
      isOrderPlaced(evt){
        if(evt){
          window.location.reload(true)
          this.setToastMessage(this.$t('payButton.placedSuccess'))
          this.payNow = false
        }else{
          this.orderPlaced('closed')
        }
      },
      orderPlaced(type = 'success', event = 'Error') {
        if(type === 'success'){
          this.setToastMessage(this.$t('payButton.placedSuccess'))
          this.$emit('success')
        } else if(type === 'error'){
          this.setToastError(event)
        } else if(type === 'closed'){
          this.payNow = false
        }
      },
      ...mapActions('common', ['setToastMessage', 'setToastError']),
    },
    created() {
    },
    async mounted() {
    }
  }
</script>

