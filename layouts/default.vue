<template>
  <div :class="routeName">
    <transition
      name="fade"
      mode="out-in"
    >
      <div
        v-if="popupWrapperVisible"
        class="popup-banner-wrapper"
      >
        <banner
          class="popup-banner"
          :banner="popupBanner"
          v-outside-click="bannerClosed"
          @close="closedPermanently"
          @clicked="closedPermanently"
        />
      </div>
    </transition>
    <Header
      @going-next="goingNext"
    />
    <main>
      <Nuxt
        :nuxt-child-key="componentId"
      />
    </main>
    <Footer/>

    <transition name="fade" mode="out-in">
      <toast-message
        v-if="toastMessageStatus"
        :is-error="toastError"
        @hide="hideToast"
        :message="toastMessage"
      />
    </transition>


    <pop-over
      v-if="!isCookieBannerClosed"
      class="cookie-banner"
      elem-id="cookie-pop-over"
      :layer-on-responsive="false"
      :layer="false"
    >
      <template v-slot:content>
        <div class="flex gap-15">
          <p class="f-9">{{ $t('date.cb') }}</p>
          <button @click.prevent="closeCookieBanner" class="outline-btn plr-15">{{ $t('date.gi') }}</button>
        </div>
      </template>
    </pop-over>



  </div>
</template>

<script>
  import Header from '~/layouts/partials/Header.vue'
  import Footer from '~/layouts/partials/Footer.vue'
  import ToastMessage from '~/components/ToastMessage.vue'
  import { mapGetters, mapActions} from 'vuex'
  import outsideClick from '~/directives/outside-click'
  import Banner from "~/components/Banner";
  import metaHelper from "~/mixin/metaHelper";
  import util from "~/mixin/util";
  import PopOver from "~/components/PopOver";

  export default {
    head() {
      return this.commonMeta({...this.site_setting, ...this.setting})
    },
    mixins: [util, metaHelper],
    data() {
      return {
        isCookieBannerClosed: true,
        componentId: null,
        loading: false,
        scrollPosition: 0,
        isPopupWrapperVisible: false
      }
    },
    components: {
      PopOver,
      Banner,
      Header,
      Footer,
      ToastMessage
    },
    directives: {
      outsideClick
    },
    watch: {},
    computed: {

      enablePixel() {
        return this.setting?.enable_pixel
      },
      pixelId() {
        return this.setting?.pixel_id
      },
      popupWrapperVisible() {
        return this.isPopupWrapperVisible && parseInt(this.popupBanner?.status) === 1
      },
      routeName() {
        return this.$route?.name?.split('___')[0] || 'error'
      },
      ...mapGetters('user', ['profile']),
      ...mapGetters('error', ['error']),
      ...mapGetters('language', ['currentLanguage']),
      ...mapGetters('common', ['setting', 'site_setting', 'popupBanner',
        'toastMessage', 'toastError', 'toastMessageStatus']),
    },
    methods: {
      closeCookieBanner(){
        localStorage.setItem('cookieBannerClosed', true)
        this.isCookieBannerClosed = true
      },
      initializeGoogleAnalytics(gaId) {
        // Initialize Google Analytics
        window.dataLayer = window.dataLayer || [];
        function gtag() {
          window.dataLayer.push(arguments);
        }
        gtag('js', new Date());
        gtag('config', gaId);
      },
      goingNext({id, url}) {
        this.componentId = id + '-' + Date.now()
        this.$router.push({path: url})
      },
      closedPermanently() {
        localStorage.setItem('popupBannerClosed', true)
        this.bannerClosed()
      },
      bannerClosed() {
        this.isPopupWrapperVisible = false
        document.body.classList.remove('no-scroll')
      },
      initializeFacebookPixel(pixelID) {
        !function (f, b, e, v, n, t, s) {
          if (f.fbq) return;
          n = f.fbq = function () {
            n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
          };
          if (!f._fbq) f._fbq = n;
          n.push = n;
          n.loaded = !0;
          n.version = '2.0';
          n.queue = [];
          t = b.createElement(e);
          t.async = !0;
          t.src = v;
          s = b.getElementsByTagName(e)[0];
          s.parentNode.insertBefore(t, s);
        }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');

        fbq('init', pixelID);
        fbq('track', 'PageView');
      },
      ...mapActions('cart', ['setCartCount']),
      ...mapActions('common', ['hideToast', 'getRequest']),
      ...mapActions('error', ['emptyError']),
      ...mapActions('user', ['setProfile', 'getUserToken']),
    },
    async mounted() {
      document.body.classList.add(this.currentLanguage?.direction || 'ltr')

      if (this.site_setting?.primary_color) {
        document.documentElement.style.setProperty('--primary-color', this.site_setting.primary_color)
        document.documentElement.style.setProperty('--primary-hover-color', this.site_setting.primary_hover_color)
      }
      if (!this.profile) {
        if(!process.env.apiBase.trim()){
          this.$axios.defaults.baseURL = window.location.origin + '/'
        }

        try {
          this.loading = true
          const data = await this.getRequest({
            params: {
              user_token: await this.getUserToken()
            },
            api: 'profile',
            requiredToken: true
          })

          if (data?.status === 200) {

            if(data?.data?.is_logged_in){
              await this.$auth.setUser(data.data)
            }

            this.setCartCount(data.data?.cart_count)
            this.setProfile(data)
          }

          this.loading = false
        } catch (e) {
          await this.$auth.logout()
          this.loading = false
          return this.$nuxt.error(e)
        }
      }

      this.isCookieBannerClosed = !this.setting?.cookie_banner || localStorage.getItem('cookieBannerClosed', false)

      if (!localStorage.getItem('popupBannerClosed', false) && parseInt(this.popupBanner?.status) === this.status.PUBLIC) {
        document.body.classList.add('no-scroll')
        this.isPopupWrapperVisible = true
      }

      if(this.setting?.enable_ga){
        const script = document.createElement('script');
        script.src = 'https://www.googletagmanager.com/gtag/js?id=' + this.setting?.ga_id;
        script.async = true;
        document.head.appendChild(script);
        script.onload = () => {
          this.initializeGoogleAnalytics(this.setting?.ga_id);
        };
      }

      if (this.setting?.enable_pixel) {
        this.initializeFacebookPixel(this.setting?.pixel_id);
      }

    }
  }
</script>
<style lang="stylus">
  main
    min-height 650px

  .error
    main
      min-height 300px

  @media only screen and (max-width: 768px)
    main
      min-height 400px
</style>
