<template>
  <div class="body-bg">
    <section class="section">
      <div class="container">

        <div class="center-text mb-30 mb-sm-15">
          <nuxt-link to="/">
            <img
              class="mx-h-55x"
              :src="imageURL({'image': site_setting.header_logo})"
              :alt="$t('footer.siteLogo')"
              height="40"
              width="139"
            >
          </nuxt-link>
        </div>

        <div class="user-form">
          <h4 class="mb-15 bold">
            {{ $t('empty.welcome', {name: site_setting.site_name }) }}
          </h4>
          <Nuxt/>
          <h5
            v-if="facebookLogin || googleLogin"
            class="bold mtb-15 center-text"
          >
            {{ $t('empty.or') }}
          </h5>
          <div class="flex flex-xs gap-10">

            <button
              v-if="facebookLogin"
              aria-label="submit"
              class="flex flex-1 gap-5 primary-btn facebook-btn"
              @click.prevent="loginWith('facebook')"
            >
              <i
                class="icon facebook-icon"
              />
              {{ $t('empty.loginFacebook') }}
            </button>

            <button
              v-if="googleLogin"
              aria-label="submit"
              class="flex flex-1 gap-5 primary-btn google-btn"
              @click.prevent="loginWith('google')"
            >
              <i
                class="icon google-icon"
              />
              {{ $t('empty.loginGoogle') }}
            </button>
          </div>
          <p class="mt-20 mt-sm-15 f-9 plr-40">
            {{ $t('empty.agreement') }}
            <nuxt-link
              :to="pageLink({slug: 'privacy-policy'})"
              class="link"
            >
              {{ $t('empty.privacyPolicy') }}
            </nuxt-link>
            .
          </p>
        </div>

        <p class="ptb-15 mt-30 mt-sm-15 b-t center-text">
          © {{ getYear }} - {{ site_setting.copyright_text }}
        </p>
      </div>
    </section>
    <transition name="fade" mode="out-in">
      <toast-message
        v-if="toastMessageStatus"
        :is-error="toastError"
        @hide="hideToast"
        :message="toastMessage"
      />
    </transition>
  </div>
</template>

<script>
  import {mapState, mapGetters, mapActions} from 'vuex'
  import util from '~/mixin/util'
  import ToastMessage from "~/components/ToastMessage";
  import metaHelper from "~/mixin/metaHelper";

  export default {
    head() {
      return this.commonMeta({...this.site_setting, ...this.setting})
    },
    components: {ToastMessage},
    mixins: [util, metaHelper],
    computed: {
      googleLogin(){
        return this.setting?.google_login
      },
      facebookLogin(){
        return this.setting?.facebook_login
      },
      routeName() {
        return this.$route?.name?.split('___')[0] || 'error'
      },
      ...mapGetters('language', ['currentLanguage']),
      ...mapState('common', ['site_setting', 'setting']),
      ...mapGetters('common', ['toastMessage', 'toastError', 'toastMessageStatus']),
    },
    methods: {
      async loginWith(service) {
        window.location.href = this.socialRedirect(service)
      },
      ...mapActions('common', ['hideToast']),
    },
    mounted() {
      document.body.classList.add(this.currentLanguage?.direction || 'ltr')


      if (this.site_setting?.primary_color) {
        document.documentElement.style.setProperty('--primary-color', this.site_setting.primary_color)
        document.documentElement.style.setProperty('--primary-hover-color', this.site_setting.primary_hover_color)
      }
    }
  }
</script>
