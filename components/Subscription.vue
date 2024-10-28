<template>
  <div
    class="subscription-wrapper pt-20 pb-15"
  >
    <div class="container">
      <div
        class="flex sided block-md"
      >
        <div class="mn-w-50 mb-10">
          <h3 class="bold">{{ $t('home.subscribeNewsletter') }}</h3>
          <p class="color-lite">{{ $t('home.getLatestEmail') }}</p>
        </div>
        <form
          class="flex mn-w-50 j-end j-start-md mb-10"
          @submit.prevent="formSubmit"
        >
          <div class="mx-w-400x grow">
            <div class="grow">
              <div
                v-if="!messageSent"
                class="flex grow wrap gap-10"
              >
                <div class="m-0 icon-input flex grow">
                  <i
                    class="icon email-icon"
                  />
                  <input
                    type="text"
                    v-model="email"
                    :placeholder="$t('contact.your', { type: $t('contact.email') })"
                    class="plr-15 grow"
                  >
                </div>


                <ajax-button
                  class="primary-btn plr-25 plr-sm-15"
                  :fetching-data="formSubmitting"
                  :text="$t('home.subscribe')"
                />
              </div>
              <div class="success-msg flex"  v-else>
                <i class="mr-10 icon tick-icon"/>
                <h4>
                  {{ $t('home.subscribeSuccessMsg') }}
                </h4>
              </div>
            </div>

            <div
              v-if="hasFormError && errors && errors.length"
            >
              <span
                class="error"
                v-for="(value, index) in errors"
                :key="index"
              >
                {{ value }}
              </span>
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
        </form>

      </div>
    </div>
  </div>
</template>

<script>
  import validation from '~/mixin/validation'
  import { mapActions } from 'vuex'
  export default {
    name: 'Subscription',
    data() {
      return {
        errors: [],
        formSubmitting: false,
        email: '',
        hasFormError: false,
        messageSent: false
      }
    },
    components: {

    },
    props: {
    },
    mixins: [validation],
    computed: {
      invalidEmail() {
        return !this.isValidEmail(this.email)
      },
    },
    methods:{
      async formSubmit() {
        if (this.email && !this.invalidEmail) {
          this.formSubmitting = true
          try {
            const data = await this.postRequest({
              params: {email: this.email},
              api: 'emailSubscription'
            })

            if (data?.status === 200) {
              this.messageSent = true
              this.hasFormError = false
            } else {
              this.hasFormError = true
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
  }
</script>

