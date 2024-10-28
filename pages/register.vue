<template>
  <div>
    <ul
      class="error-list mb-15"
      v-if="errors.length"
    >
      <li
        class="mb-10"
      >
        {{ $t('forgotPassword.errorOccurred') }}
      </li>
      <li
        v-for="(value, index) in errors"
        :key="index"
      >
        {{ value }}
      </li>
    </ul>

    <form
      @submit.prevent="formSubmit"
      v-if="!emailVerificationForm && !verified"
    >
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

      <div
        class="mt-20 mt-sm-15 mb-10"
      >
        {{ $t('register.haveAccount') }}
        <nuxt-link
          to="/login"
          class="mlr-10 link bold color-primary"
        >
          {{ $t('forgotPassword.signIn') }}
        </nuxt-link>
      </div>
    </form>

    <form
      @submit.prevent="verifyEmail"
      v-else-if="emailVerificationForm && !verified"
    >
      <p
        class="mb-15"
      >
        {{ $t('register.sentEmail') }}
      </p>

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
      v-else-if="emailVerificationForm && verified"
    >
      <h4
        class="mb-15 bold"
      >
        {{ $t('contact.success') }}!!!
      </h4>
      <p
        class="mb-15"
      >
        <b>{{ $t('forgotPassword.congratulations') }}</b>.
        {{ $t('forgotPassword.verified') }}
      </p>
      <p
        class="mb-15"
      >
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
  import {mapGetters} from 'vuex'
  import global from '~/mixin/global'

  export default {
    middleware: ['common-middleware', 'non-logged-in'],
    layout: "empty",
    data() {
      return {
        name: '',
        code: '',
        email: '',
        password: '',
        confirmPassword: '',
        formSubmitting: false,
        hasFormError: false,
        emailVerificationForm: false,
        verified: false,
        errors: []
      }
    },
    components: {
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
      ...mapGetters('language', ['langCode']),
    },
    methods: {
      async verifyEmail() {
        if (this.code) {
          this.formSubmitting = true
          try {
            const {data, status} = await this.$store.dispatch('user/verify', {
              params: {
                code: this.code,
                email: this.email
              },
              lang: this.langCode
            })

            if (status === 200) {
              this.verified = true
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
      },
      async formSubmit() {
        if (this.name && this.email && this.password && (this.password === this.confirmPassword)) {
          this.formSubmitting = true
          try {
            const {data, status} = await this.$store.dispatch('user/registration', {
                params: {
                  name: this.name,
                  email: this.email,
                  password: this.password
                },
                lang: this.langCode
              }
            )

            if (status === 200) {
              this.hasFormError = false
              this.errors = []
              this.emailVerificationForm = true
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
    mounted() {
    },
  }
</script>

<style>

</style>
