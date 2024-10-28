<template>
  <div>
    <transition name="fade" mode="out-in">
      <pop-over
        v-if="showPopup"
        @close="closePopOver"
        :elem-id="'card-pop-over'"
        class="card-popup popup-top-auto"
        :layer="true"
        :outside-click-on="false"
      >
        <template v-slot:heading>
          <div>
            <h3
              class="color-inherit semi-bold"
            >
              {{ siteName }}
            </h3>
            <h6
              class="color-inherit opacity-8 mb-5"
            >
              {{ $t('stripePayment.bestDeal') }}
            </h6>
            <h3
              class="color-inherit"
            >
              <price-format
                :price="amount"
              />
            </h3>
          </div>
        </template>
        <template v-slot:content>
          <form
            action=""
            method="post"
            id="payment-form"
            class="stripe-form"
            :class="{'opacity-0': loader}"
          >
            <div class="input-wrap">
              <label>
                {{ $t('stripePayment.creditDebit') }}
              </label>
              <div
                id="card-number"
              />
            </div>

            <div class="flex">
              <div class="input-wrap">
                <label>
                  {{ $t('stripePayment.creditExpiry') }}
                </label>
                <div id="card-expiry"></div>
              </div>

              <div class="input-wrap">
                <label>
                  {{ $t('stripePayment.creditCvc') }}
                </label>
                <div id="card-cvc"></div>
              </div>
            </div>
            <!-- Used to display Element errors. -->
            <div
              id="card-errors"
              role="alert"
            />
            <p class="error">
              {{ errorText }}
            </p>
          </form>
        </template>
        <template v-slot:pop-footer>
          <ajax-button
            class="primary-btn w-100"
            :type="'button'"
            :fetching-data="submitting"
            @clicked="createStripeToken"
            :loading-text="$t('stripePayment.placing')"
            :text="payBtnText"
          />
        </template>
      </pop-over>
    </transition>
  </div>

</template>
<script>
  import {mapGetters, mapActions} from 'vuex'
  import paymentHelper from '~/mixin/paymentHelper'
  import util from '~/mixin/util'
  import PriceFormat from "./PriceFormat";
  import AjaxButton from "./AjaxButton";
  import PopOver from "./PopOver";

  export default {
    name: 'StripePayment',
    data() {
      return {
        stripe: null,
        card: null,
        showPopup: true,
        loader: true,
        submitting: false,
        errorText: '',
      }
    },
    mixins: [util, paymentHelper],
    watch: {},
    props: {
      orderId: {
        type: Number,
        default: ''
      },
      stripeKey: {
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
      PopOver,
      AjaxButton,
      PriceFormat
    },
    computed: {
      payBtnText(){
        return this.$t('stripePayment.pay', { amount: this.formattedPrice})
      },
      formattedPrice(){
        return this.priceFormat(this.currencyPosition, this.currencyIcon, this.amount, this.setting)
      },
      ...mapGetters('language', ['langCode']),
      ...mapGetters('common', ['currencyIcon', 'currencyPosition', 'setting'])
    },
    methods: {
      closePopOver(){
        this.$emit('closed')
        this.showPopup = false
        this.$destroy()
        this.$el.parentNode.removeChild(this.$el)
      },
      initPayment(){
        this.stripe = Stripe(this.stripeKey);
        var elements = this.stripe.elements();
        var style = {
          base: {
            iconColor: '#666EE8',
            color: '#31325F',
            lineHeight: '40px',
            '::placeholder': {
              color: '#CFD7E0',
            },
          },
        };
        // Create an instance of the card Element.
        this.card = elements.create('cardNumber', {
          style: style,
          showIcon: true,
        })
        const cardExpiry = elements.create('cardExpiry', {
          style: style
        })
        const cardCvc = elements.create('cardCvc', {
          style: style
        })

        // Add an instance of the card Element into the `card-element` <div>.
        this.card.mount('#card-number')
        cardExpiry.mount('#card-expiry')
        cardCvc.mount('#card-cvc')
        this.loader = false
      },
      createStripeToken() {
        this.errorText = ''
        this.submitting = true
        this.stripe
          .createToken(this.card, { name: this.$auth?.user?.name})
          .then(async result => {
            if (result.error) {
              this.submitting = false
              this.errorText = result.error.message
            } else {

              await this.paymentDoneFn(this.orderId, result.token.id, this.orderMethods.STRIPE)
            }
          });
      },
      ...mapActions('user', ['getUserToken']),
      ...mapActions('common', ['setToastMessage', 'setToastError']),
      ...mapActions('order', ['paymentDone']),
    },
    created() {
    },
    async mounted() {
      let recaptchaScript = document.createElement('script')
      recaptchaScript.setAttribute('src', 'https://js.stripe.com/v3/')
      document.head.appendChild(recaptchaScript)

      recaptchaScript.onload = () => {
        this.initPayment()
      }
    }
  }
</script>

