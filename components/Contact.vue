<template>
  <div class="container">
    <div class="contact-wrapper">

      <breadcrumb
        :page="pageTitle"
      />

      <h1 class="page-title">{{ $t('contact.contactUs') }}</h1>
      <p class="mt-10 mb-30 mb-sm-15 f-12">{{ $t('contact.feelFree') }}</p>


      <div class="flex">

        <div class="contact-form">

          <form
            v-if="!messageSent"
            @submit.prevent="formSubmit"
          >
            <ul
              class="error-list mb-15"
              v-if="errors.length"
            >
              <li
                class="mb-10"
              >
                {{ $t('contact.errorOccurred') }}
              </li>
              <li
                v-for="(value, index) in errors"
                :key="index"
              >
                {{ value }}
              </li>
            </ul>


            <div class="flex">
              <div
                class="input-wrap"
                :class="{invalid: !name && hasFormError}"
              >
                <label>{{ $t('addressPopup.name') }}</label>
                <input
                  type="text"
                  v-model="name"
                  :placeholder="$t('contact.your', { type: $t('contact.name') })"
                >
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
                <input
                  type="text"
                  v-model="email"
                  :placeholder="$t('contact.your', { type: $t('contact.email') })"
                >
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
            </div>


            <div
              class="input-wrap"
              :class="{invalid: !subject && hasFormError}"
            >
              <label>
                {{ $t('addressPopup.subject') }}
              </label>
              <input
                type="text"
                v-model="subject"
                :placeholder="$t('addressPopup.subject')"
              >
              <span
                class="error"
                v-if="!subject && hasFormError"
              >
              {{ $t('addressPopup.isRequired', {type: $t('addressPopup.subject') }) }}
            </span>
            </div>


            <div
              class="input-wrap"
              :class="{invalid: !message && hasFormError}"
            >
              <label>
                {{ $t('addressPopup.message') }}
              </label>
              <textarea
                v-model="message"
                :placeholder="$t('addressPopup.message')"
              />
              <span
                class="error"
                v-if="!message && hasFormError"
              >
                {{ $t('addressPopup.isRequired', {type: $t('addressPopup.message') }) }}
              </span>
            </div>
            <div class="flex j-end m-0">
              <ajax-button
                class="primary-btn plr-30 plr-sm-15"
                :fetching-data="formSubmitting"
              />
            </div>

          </form>

          <div v-else>
            <h4
              class="mb-15 bold"
            >
              {{ $t('contact.success') }}!!!
            </h4>
            <h5 class="mb-15">
              {{ $t('contact.successMessage') }}
            </h5>
            <p class="mb-15">
              <nuxt-link
                to="/"
                class="link bold color-primary"
              >
                {{ $t('contact.goToHome') }}
              </nuxt-link>
              {{ $t('contact.now') }}.
            </p>
          </div>
        </div>
        <div class="contact-info pos-rel">

          <div
            class="spinner-wrapper flex"
            v-if="loading"
          >
            <spinner
              :radius="100"
            />
          </div>

          <div
            v-if="phone"
            class="flex ">
            <span>
              <i class="icon phone-icon"/>
            </span>
            <div>
              <h4 class="mb-10 bold">{{ $t('addressPopup.phone') }}</h4>
              <a
                :href="`tel:${phone}`"
              >
                {{ phone }}
              </a>
            </div>
          </div>


          <div class="flex">
          <span>
            <i
              class="icon email-icon"
            />
          </span>
            <div>
              <h4 class="mb-10 bold">{{ $t('addressPopup.email') }}</h4>
              <a
                :href="`mailto:${contactEmail}`"
              >
                {{ contactEmail }}
              </a>
            </div>
          </div>

          <div class="flex">

            <span>
              <i
                class="icon location-icon"
              />
            </span>
            <div v-if="countryList">
              <h4 class="mb-10 bold">{{ $t('addressPopup.address') }}</h4>
              <p v-html="formatAddress(setting)"/>
            </div>

          </div>
        </div>
      </div>

    </div>
  </div>
</template>

<script>
  import addressHelper from '~/mixin/addressHelper'
  import util from '~/mixin/util'
  import validation from '~/mixin/validation'
  import {mapGetters, mapActions} from 'vuex'
  import Breadcrumb from "~/components/Breadcrumb"
  import AjaxButton from "~/components/AjaxButton"
  import Spinner from "~/components/Spinner";

  export default {
    name: 'Contact',
    components: {Spinner, AjaxButton, Breadcrumb},
    props: {
      pageTitle: {
        type: String,
        default: ''
      },
    },
    data() {
      return {
        name: '',
        email: '',
        subject: '',
        errors: [],
        message: '',
        formSubmitting: false,
        loading: false,
        hasFormError: false,
        messageSent: false,
      }
    },
    mixins: [util, validation, addressHelper],
    watch: {},
    computed: {
      invalidEmail() {
        return !this.isValidEmail(this.email)
      },
      emailValid() {
        return this.email && !this.invalidEmail
      },
      contactEmail() {
        return this.setting?.email
      },
      phone() {
        return this.setting?.phone
      },
      ...mapGetters('language', ['langCode']),
      ...mapGetters('resource', ['countryList', 'phoneList']),
      ...mapGetters('common', ['setting']),
    },
    methods: {

      async formSubmit() {
        if (this.email && this.name && this.subject && this.message) {
          this.formSubmitting = true
          try {
            const data = await this.contactUs({
              name: this.name,
              email: this.email,
              subject: this.subject,
              message: this.message
            })

            if (data?.status === 200) {
              this.messageSent = true
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
      ...mapActions('common', ['getRequest']),
      ...mapActions('resource', ['setCountryList', 'setPhoneList']),
      ...mapActions('contact', ['contactUs']),
    },
    async mounted() {

      if (!this.countryList || !this.phoneList) {
        this.loading = true

        const {data} = await this.getRequest({
          params: null,
          lang: this.langCode,
          api: 'countriesPhones'
        })

        this.setCountryList(data?.countries)
        this.setPhoneList(data?.phones)
        this.loading = false
      }

    }
  }
</script>
<style lang="stylus">
</style>
