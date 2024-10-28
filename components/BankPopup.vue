<template>
  <pop-over
    :title="$t('date.pv')"
    @close="closeBankVerify"
    :layer="true"
    class="bank-popup"
    elem-id="verify-bank"
  >


    <template v-slot:content>
      <p class="mn-w-350x mn-w-sm-0">
        {{ $t('date.kr') }}
      </p>

      <div class="bank-detail mt-30 mt-sm-20 mb-30 mb-sm-20">
        <div>
          <label class="bold block mb-5">{{ $t('date.bn') }}</label>
          <label class="color-lite">{{ paymentGateway.bank_name }}</label>
        </div>

        <div>
          <label class="bold block mb-5">{{ $t('date.ahn') }}</label>
          <label class="color-lite">{{ paymentGateway.account_name }}</label>
        </div>

        <div>
          <label class="bold block mb-5">{{ $t('date.an') }}</label>
          <label class="color-lite">{{ paymentGateway.account_number }}</label>
        </div>

        <div>
          <label class="bold block mb-5">{{ $t('date.brn') }}</label>
          <label class="color-lite">{{ paymentGateway.branch_name }}</label>
        </div>
      </div>


      <form
        @submit.prevent="formSubmit"
      >

        <error-handler
          :errors="errors"
        />

        <div
          class="input-wrap"
          :class="{invalid: !transId && hasFormError}"
        >
          <label class="color-lite">{{ $t('date.ti') }}</label>

          <div class="icon-input">
            <i
              class="icon trans-icon"
            />
            <input
              type="text"
              v-model="transId"
              placeholder="eg. 20230704N2H5X2"
            >
          </div>

          <span
            class="error"
            v-if="!transId && hasFormError"
          >
            {{ $t('addressPopup.isRequired', {type: $t('date.ti') }) }}
          </span>
        </div>


        <div ref="submitBtn" class="flex right gap-10 no-space">
          <ajax-button
            type="button"
            class="outline-btn plr-20 w-100x"
            :text="$t('addressPopup.cancel') "
            :loading-text="$t('forgotPassword.registering')"
            @clicked="closeBankVerify"
          >

          </ajax-button>

          <ajax-button
            class="primary-btn plr-20 w-150x"
            :fetching-data="formSubmitting"
            :loading-text="$t('forgotPassword.registering')"
          />
        </div>

      </form>


    </template>
  </pop-over>

</template>

<script>
  import {mapGetters, mapActions} from 'vuex'
  import PopOver from "./PopOver";
  import AjaxButton from "./AjaxButton";
  import ErrorHandler from "./ErrorHandler";
  import paymentHelper from '~/mixin/paymentHelper'

  export default {
    name: 'BankPopup',
    data() {
      return {
        formSubmitting: false,
        hasFormError: false,
        transId: '',
        errors: []
      }
    },
    watch: {},
    props: {
      order: {
        type: Object,
        default() {
          return null
        },
      },
    },
    components: {
      ErrorHandler,
      AjaxButton,
      PopOver,
    },
    computed: {
      orderId() {
        return parseInt(this.$route.params.id)
      },
      ...mapGetters('common', ['paymentGateway'])
    },
    mixins: [paymentHelper],
    methods: {
      async formSubmit(){
        if(this.transId){
          this.hasFormError = false
          try {
            this.formSubmitting = true
            const data = await this.postRequest({
              params: {
                data: this.phpEncryption({
                  id: this.orderId,
                  trans_id: this.transId,
                  user_token: await this.getUserToken()
                })
              },
              api: 'setTransaction',
              requiredToken: true
            })
            if (data?.status === 200) {
              this.closeBankVerify()
              this.setToastMessage(this.$t('date.pds'))

            } else {
              this.errors = data?.data?.form
            }
            this.formSubmitting = false
          } catch (e) {
            return this.$nuxt.error(e)
          }
        } else {
          this.hasFormError = true
        }
      },
      closeBankVerify(){
        this.$emit('close', this.transId)
      },
      ...mapActions('user', ['getUserToken']),
      ...mapActions('common', ['getRequest','postRequest', 'setToastMessage', 'setToastError'])
    },
    created() {
    },
    async mounted() {
      this.transId = this.order?.trans_id

      if(!this.paymentGateway){
        const data = await this.getRequest({
          params: {},
          api: 'paymentGateway'
        })
        this.setPaymentGateway(data.data)
      }
    }
  }
</script>
