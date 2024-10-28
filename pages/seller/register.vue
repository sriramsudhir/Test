<template>
  <div>
    <form
      v-if="!emailVerificationForm && !verified"
      class="seller-form user-form"
      @submit.prevent="formSubmit"
    >
      <div class="center-text mb-30">
        <h6>{{ $t('date.reg') }}</h6>
        <h1 class="mt-10 mb-20 color-primary">{{ $t('date.sr') }}</h1>
        <p>{{ $t('date.pm') }}</p>

      </div>

      <error-handler
        :errors="errors"
      />

      <div
        class="input-wrap"
        :class="{invalid: !name && hasFormError}"
      >
        <label>{{ $t('addressPopup.name') }}</label>

        <div class="icon-input">
          <i
            class="icon user-icon"
          />
          <input
            type="text"
            v-model="name"
            :placeholder="$t('contact.your', { type: $t('contact.name') })"
          >
        </div>

        <span
          class="error"
          v-if="!name && hasFormError"
        >
          {{ $t('addressPopup.isRequired', {type: $t('addressPopup.name') }) }}
        </span>
      </div>

      <div
        class="input-wrap"
        :class="{invalid: !storeName && hasFormError}"
      >
        <label>{{ $t('date.sn') }}</label>

        <div class="icon-input">
          <i
            class="icon user-icon"
          />
          <input
            type="text"
            v-model="storeName"
            :placeholder="$t('date.sn')"
          >
        </div>
        <span
          class="error"
          v-if="!storeName && hasFormError"
        >
          {{ $t('addressPopup.isRequired', {type: $t('date.sn') }) }}
        </span>
      </div>

      <div
        class="input-wrap"
        :class="{invalid: !emailValid && hasFormError}"
      >
        <label>{{ $t('addressPopup.email') }}</label>

        <div class="icon-input">
          <i
            class="icon email-icon"
          />
          <input
            type="text"
            v-model="email"
            :placeholder="$t('contact.your', { type: $t('contact.email') })"
          >
        </div>

        <span
          class="error"
          v-if="!email && hasFormError"
        >
           {{ $t('addressPopup.isRequired', {type: $t('addressPopup.email') }) }}
        </span>
        <span
          class="error"
          v-else-if="invalidEmail && hasFormError"
        >
          {{ $t('contact.invalidEmail') }}
        </span>
      </div>

      <div
        class="input-wrap"
        :class="{invalid: !passwordValid && hasFormError}"
      >
        <label>{{ $t('profile.password') }}</label>
        <password-field
          :value="password"
          @change="password = $event"
        />
        <span
          class="error"
          v-if="!password && hasFormError"
        >
           {{ $t('addressPopup.isRequired', {type: $t('profile.password') }) }}
        </span>
        <span
          class="error"
          v-else-if="invalidPassword && hasFormError"
        >
           {{ $t('profile.invalidLength') }}
        </span>
      </div>

      <div
        class="input-wrap"
        :class="{invalid: (!passwordValid || confirmPassword !== password)  && hasFormError}"
      >
        <label>
          {{ $t('profile.confirmPassword') }}
        </label>
        <password-field
          :value="confirmPassword"
          @change="confirmPassword = $event"
        />
        <span
          class="error"
          v-if="!confirmPassword && hasFormError"
        >
          {{ $t('addressPopup.isRequired', {type: $t('profile.password') }) }}
        </span>
        <span
          class="error"
          v-else-if="confirmPassword !== password && hasFormError"
        >
          {{ $t('profile.noMatch') }}
        </span>
      </div>

      <div class="flex right no-space">
        <ajax-button
          class="primary-btn plr-20 w-50"
          :fetching-data="formSubmitting"
          :loading-text="$t('forgotPassword.registering')"
        >
          {{ $t('ajaxButton.submit') }}
        </ajax-button>
      </div>

    </form>

    <form
      class="seller-form user-form"
      @submit.prevent="verifyEmail"
      v-if="emailVerificationForm && !verified"
    >
      <div class="center-text mb-30">
        <h1 class="mt-10 mb-20 color-primary">Verification</h1>
        <p>{{ $t('register.sentEmail') }}</p>
      </div>

      <error-handler
        :errors="errors"
      />

      <div
        class="input-wrap"
        :class="{invalid: !code && hasFormError}"
      >
        <label>
          {{ $t('forgotPassword.code') }}
        </label>
        <input
          type="text"
          v-model="code"
          :placeholder="$t('forgotPassword.codeFrom')"
        >
        <span
          class="error"
          v-if="!code && hasFormError"
        >
           {{ $t('addressPopup.isRequired', {type: $t('forgotPassword.code') }) }}
        </span>
      </div>

      <div class="flex right no-space">
        <ajax-button
          class="primary-btn plr-20 w-50"
          :fetching-data="formSubmitting"
          :loading-text="$t('checkoutRight.submitting')"
        >
          {{ $t('ajaxButton.submit') }}
        </ajax-button>
      </div>
    </form>


    <div
      class="seller-form user-form"
      v-else-if="emailVerificationForm && verified"
    >

      <h1 class="mt-10 mb-20 color-primary">{{ $t('contact.success') }}!!!</h1>
      <p
        class="mb-15"
      >
        <b>{{ $t('forgotPassword.congratulations') }}</b>.
        {{ $t('forgotPassword.verified') }}
      </p>
      <p
        class="mb-15"
      >
        {{ $t('date.yw') }}
      </p>
      <p
        class="mb-15"
      >
        <nuxt-link
          to="/"
          class="mlr-10 link bold color-primary"
        >
          {{ $t('date.gh') }}

        </nuxt-link>
      </p>
    </div>

  </div>
</template>
<script>
  import validation from '~/mixin/validation'
  import AjaxButton from '~/components/AjaxButton'
  import PasswordField from '~/components/PasswordField'
  import {mapGetters, mapActions} from 'vuex'
  import ErrorHandler from "~/components/ErrorHandler";
  import global from '~/mixin/global'

  export default {
    middleware: ['common-middleware'],
    layout: "default",
    data() {
      return {
        name: '',
        email: '',
        verified: false,
        code: '',
        password: '',
        storeName: '',
        confirmPassword: '',
        emailVerificationForm: false,
        formSubmitting: false,
        hasFormError: false,
        errors: []
      }
    },
    components: {
      ErrorHandler,
      AjaxButton,
      PasswordField
    },
    mixins: [validation, global],
    computed: {
      invalidEmail() {
        return !this.isValidEmail(this.email)
      },
      emailValid() {
        return this.email && !this.invalidEmail
      },
      invalidPassword() {
        return !this.isValidLength(this.password)
      },
      passwordValid() {
        return this.password && !this.invalidPassword
      },
      sellerSignUp(){
        return this.setting?.vendor_registration
      },
      ...mapGetters('common', ['setting']),
      ...mapGetters('language', ['langCode']),
    },
    methods: {
      async verifyEmail() {
        if (this.code) {
          this.formSubmitting = true
          try {

            const data = await this.postRequest({
              params: {
                code: this.code,
                email: this.email
              },
              lang: this.langCode,
              api: 'sellerVerify',
              requiredToken: false
            })

            if (data?.status === 200) {
              this.verified = true
              this.hasFormError = false
              this.errors = []
            } else {
              this.errors = data?.data?.form
            }

          } catch (e) {
            return this.$nuxt.error(e)
          }
          this.formSubmitting = false

        } else {
          this.hasFormError = true
        }
      },

      async formSubmit() {
        if (this.name && this.email && this.password && (this.password === this.confirmPassword)) {
          this.formSubmitting = true
          try {

            const data = await this.postRequest({
              params: {
                name: this.name,
                store_name: this.storeName,
                email: this.email,
                password: this.password
              },
              api: 'sellerRegister',
              requiredToken: false
            })

            if (data?.status === 200) {
              this.hasFormError = false
              this.errors = []
              this.emailVerificationForm = true
            } else {
              this.errors = data?.data?.form
            }

          } catch (e) {
            return this.$nuxt.error(e)
          }
          this.formSubmitting = false

        } else {
          this.hasFormError = true
        }
      },
      ...mapActions('common', ['postRequest'])
    },
    mounted() {
      if(!this.sellerSignUp) {
        return this.$nuxt.error({ statusCode: 404, message: this.$t('date.nf') })
      }
    },
  }
</script>

<style>

</style>
