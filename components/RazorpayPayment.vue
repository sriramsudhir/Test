<template>
  <div class="">

    <input
      ref="payBtn"
      type="hidden"
      @click.prevent="makePayment"
      class="btn btn-success"
      :value="$t('ajaxButton.submit')"
    />
  </div>
</template>
<script>
  import {mapActions} from 'vuex'
  import paymentHelper from '~/mixin/paymentHelper'
  import util from "~/mixin/util";
  export default {
    name: 'RazorpayPayment',
    data() {
      return {}
    },
    watch: {},
    props: {
      orderId: {
        type: Number,
        default: ''
      },
      razorpayPaymentToken: {
        type: String,
        default: ''
      },
      razorpayKey: {
        type: String,
        default: ''
      },
      currency: {
        type: String,
        default: 'USD'
      },
      amount: {
        type: Number,
        default: 0
      },
      userName: {
        type: String,
        default: ''
      },
      siteName: {
        type: String,
        default: ''
      },
      userEmail: {
        type: String,
        default: ''
      }
    },
    components: {
    },
    computed: {
    },
    mixins: [util, paymentHelper],
    methods: {
      makePayment(){

        const self = this
        //Initiation of Razorpay PG
        var rzp1 = new Razorpay({
          key: this.razorpayKey,
          amount: parseInt(this.amount * 100),
          name: this.siteName,
          currency: this.currency,
          description: this.$t('payment.bestDeal'),
          //Uncomment if you are using handler function
          "handler": async (response)=>{
            if(response.razorpay_order_id === self.razorpayPaymentToken){
              await this.paymentDoneFn(this.orderId, response.razorpay_order_id, this.orderMethods.RAZORPAY)
            }
          },
          "modal": {
            "ondismiss": function(){
              self.$emit('closed')
            }
          },
          //callback_url: 'http://13.126.183.214/razorpay/checkstatus/?orderid='+this.order_id,
          prefill: {
            name: this.userName,
            email: this.userEmail
          },
          notes: {
            address: ""
          },
          theme: {
            color: "#6F55D5"
          },
          order_id: this.razorpayPaymentToken,
          // callback_url: 'http://127.0.0.1:3000/razorpay-callback',
          redirect: false
        });
        rzp1.on('payment.failed', function (response){

          console.log(response.error.description);
          console.log(response.error.source);
          console.log(response.error.step);
          console.log(response.error.reason);
          this.$emit('error', response.error.description)
        });
        rzp1.open();
      },
      ...mapActions('user', ['getUserToken']),
      ...mapActions('common', ['setToastMessage', 'setToastError']),
      ...mapActions('order', ['paymentDone']),
    },
    created() {
    },
    async mounted() {
      let recaptchaScript = document.createElement('script')
      recaptchaScript.setAttribute('src', 'https://checkout.razorpay.com/v1/checkout.js')
      document.head.appendChild(recaptchaScript)

      recaptchaScript.addEventListener('load', (event) => {
        this.$refs.payBtn.click()
      });
      //
    }
  }
</script>



