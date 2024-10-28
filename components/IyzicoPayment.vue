<template>
  <div>

    <ajax-button
      class="primary-btn  plr-30 plr-sm-15"
      type="button"
      :fetching-data="placingOrder"
      :text="btnText"
      @clicked="confirmOrder"
    />

    <p
      v-if="errorText"
      class="error">
      {{ errorText }}
    </p>
  </div>

</template>
<script>
  import {mapActions} from 'vuex'
  import Spinner from "./Spinner";
  import util from "~/mixin/util";
  import paymentHelper from "~/mixin/paymentHelper";
  import AjaxButton from "./AjaxButton";


  export default {
    name: 'IyzicoPayment',
    data() {
      return {
        errorText: '',
        placingOrder: false
      }
    },
    watch: {},
    props: {
      order: {
        type: Object,
        default() {
          return null
        }
      },
      btnText: {
        type: String,
        default: ''
      },
    },
    components: {
      AjaxButton,
      Spinner
    },
    computed: {},
    mixins: [util],
    methods: {
      confirmOrder() {
        this.placingOrder = true
        this.$emit('clicked')
      },

      makePayment(isCheckoutPage = false) {
        if (this.order?.iyzico_payment) {

          if (this.order?.iyzico_payment?.status === 'success') {

            if (isCheckoutPage) {
              this.$emit('success', {
                id: this.order?.id,
                redirect: false
              })
            }
            window.location.href = this.order?.iyzico_payment?.paymentPageUrl

          } else if (this.order?.iyzico_payment?.status === 'failure') {

            this.$emit('error', this.order?.iyzico_payment?.errorMessage)

          } else {
            this.$emit('closed', this.order.id)
          }

          this.placingOrder = false
        }
      },
    },
    created() {
    },
    async mounted() {
    }
  }
</script>

