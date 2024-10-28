<template>
  <form @submit.prevent="formSubmit">
    <ul
      class="error-list mb-15"
      v-if="errors.length"
    >
      <li class="mb-10">
        {{ $t('forgotPassword.errorOccurred') }}
      </li>
      <li
        v-for="(value, index) in errors"
        :key="index"
      >
        {{ value }}
      </li>
    </ul>

    <div
      class="input-wrap"
      :class="{invalid: !emailValid && hasFormError}"
    >
      <label>
        {{ $t('addressPopup.email') }}
      </label>
      <div class="icon-input">
        <i
          class="icon email-icon"
        />
        <input
          type="text"
          :placeholder="$t('contact.your', { type: $t('contact.email') })"
          v-model.trim="email"
        >
      </div>
      <span
        class="error"
        v-if="!email && hasFormError"
      >
        {{ $t('addressPopup.isRequired', {type: $t('addressPopup.email')}) }}
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

    <div class="no-space flex sided">
      <nuxt-link
        to="/forgot-password"
        class="link color-lite"
      >
        {{ $t('login.forgotPassword') }}
      </nuxt-link>

      <ajax-button
        class="primary-btn plr-30 plr-sm-15"
        :fetching-data="formSubmitting"
        :loading-text="$t('login.loggingIn')"
      />
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
</template>
<script>

  import {mapActions} from 'vuex'
  import validation from '~/mixin/validation'
  import util from '~/mixin/util'
  import AjaxButton from '~/components/AjaxButton'
  import PasswordField from '~/components/PasswordField'
  import global from '~/mixin/global'

  export default {
    middleware: ['common-middleware', 'non-logged-in'],
    layout: "empty",
    data() {
      return {
        email: '',
        password: '',
        hasFormError: false,
        errors: [],
        formSubmitting: false
      }
    },
    components: {
      AjaxButton,
      PasswordField
    },
    mixins: [validation, util, global],
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
      }
    },
    methods: {
      async formSubmit() {
        if (this.email && this.password && !this.invalidPassword) {
          this.formSubmitting = true
          try {

            if(!process.env.apiBase.trim()){
              this.$axios.defaults.baseURL = window.location.origin + '/'
            }

            const {data} = await this.$auth.loginWith('local',
              {
                data: {
                  user_token: await this.getUserToken(),
                  password: this.password,
                  email: this.email
                }
              })

            if (data?.status === 200) {
              this.hasFormError = false
              this.setProfile(data.data?.user)
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
      ...mapActions('user', ['setProfile', 'getUserToken']),
    },
    mounted(){
    },
  }
</script>

<style>

</style>
