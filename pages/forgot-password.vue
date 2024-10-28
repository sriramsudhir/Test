<template>
  <div>
    <form @submit.prevent="formSubmit" v-if="!emailSubmitted || !passwordUpdated">

      <ul class="error-list mb-15" v-if="errors.length">
        <li class="mb-10">
          {{ $t('forgotPassword.errorOccurred') }}
        </li>
        <li v-for="(value, index) in errors" :key="index">{{ value }}</li>
      </ul>

      <div class="input-wrap" :class="{invalid: !emailValid && hasFormError}">
        <label>
          {{ $t('addressPopup.email') }}
        </label>

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
      <template v-if="emailSubmitted">
        <div class="input-wrap" :class="{invalid: !code && hasFormError}">
          <label>
            {{ $t('forgotPassword.code') }}
          </label>

          <div class="icon-input">
            <i
              class="icon code-icon"
            />
            <input
              type="text"
              v-model="code"
              :placeholder="$t('forgotPassword.codeFrom')"
            >
          </div>

          <span
            class="error"
            v-if="!code && hasFormError"
          >
            {{ $t('addressPopup.isRequired', {type: $t('forgotPassword.code') }) }}
            Code is Required
          </span>
        </div>

        <div
          class="input-wrap"
          :class="{invalid: !passwordValid && hasFormError}"
        >
          <label>
            {{ $t('profile.password') }}
          </label>

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
      </template>

      <div class="flex right no-space">
        <ajax-button
          class="primary-btn plr-20 w-50"
          :fetching-data="formSubmitting"
          :loading-text="$t('checkoutRight.submitting')"
        >
          {{ $t('ajaxButton.submit') }}
        </ajax-button>
      </div>

      <div class="mt-20 mt-sm-15 mb-10">
        {{ $t('forgotPassword.noAccount') }}
        <nuxt-link
          to="/register"
          class="mlr-10 link bold color-primary"
        >
          {{ $t('forgotPassword.createAccount') }}
        </nuxt-link>
      </div>
    </form>

    <div v-else-if="emailSubmitted && passwordUpdated">
      <h4 class="mb-15 bold">{{ $t('contact.success') }}!!!</h4>
      <p class="mb-15">
        <b>{{ $t('forgotPassword.congratulations') }}</b>.
        {{ $t('forgotPassword.verified') }}
      </p>
      <p class="mb-15">
        {{ $t('forgotPassword.youCan') }}
        <nuxt-link
          to="/login"
          class="mlr-10 link bold color-primary"
        >
          {{ $t('forgotPassword.signIn') }}
        </nuxt-link>
        {{ $t('contact.now') }}.
      </p>
    </div>
  </div>
</template>
<script>
  import validation from '~/mixin/validation'
  import AjaxButton from '~/components/AjaxButton'
  import PasswordField from '~/components/PasswordField'
  import { mapGetters, mapActions } from 'vuex'
  import global from '~/mixin/global'

  export default {

    middleware: ['common-middleware', 'non-logged-in'],
    layout: "empty",
    data() {
      return {
        email: '',
        password: '',
        code: '',
        confirmPassword: '',
        errors: [],
        hasFormError: false,
        formSubmitting: false,
        emailSubmitted: false,
        passwordUpdated: false
      }
    },
    components: {
      AjaxButton,
      PasswordField
    },
    watch: {
      email() {
        if (!this.invalidEmail) {
          this.hasFormError = false
        }
      }
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
      ...mapGetters('language', ['langCode']),
    },
    methods: {
      async formSubmit() {
        if (!this.emailSubmitted && this.email) {
          if (this.email) {
            this.formSubmitting = true
            try {

              const {data, status} = await this.$store.dispatch('user/forgotPassword', {
                params: {
                  email: this.email
                },
                lang: this.langCode
              })

              if (status === 200) {
                this.setToastMessage(this.$t('forgotPassword.sentEmail'))
                this.emailSubmitted = true
                this.hasFormError = false
                this.errors = []
              } else {
                this.errors = data.form
              }

            } catch (e) {
              return this.$nuxt.error(e)
            }
            this.formSubmitting = false

          } else {
            this.hasFormError = true
          }
        } else {
          if (this.code && this.email && this.password && (this.password === this.confirmPassword)) {
            this.formSubmitting = true
            try {
              const {data, status} = await this.$store.dispatch('user/updatePassword', {
                params: {
                  email: this.email,
                  code: this.code,
                  password: this.password
                },
                lang: this.langCode
              })
              if (status === 200) {
                this.passwordUpdated = true
                this.hasFormError = false
                this.errors = []
              } else {
                this.errors = data.form
              }
            } catch (e) {
              return this.$nuxt.error(e)
            }
            this.formSubmitting = false
          } else {
            this.hasFormError = true
          }
        }
      },
      ...mapActions('common', ['setToastMessage'])
    },
    mounted(){
    }
  }
</script>

<style>

</style>
