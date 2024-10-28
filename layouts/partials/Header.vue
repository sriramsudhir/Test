<template>
  <header
    :class="{'no-banner': (topBannerLoaded && isTopBannerClosed) || !isPublic}"
  >
      <banner
        v-if="!isTopBannerClosed"
        class="top-banner"
        :banner="topBanner"
        @close="topBannerClosed"
      />

    <div class="top-wrapper">
      <div class="container-fluid">

        <div ref="headerWrapper"  class="wrap flex sided">
          <div class="left-side wrap flex gap-10">
            <dropdown
              v-if="Object.keys(languages).length > 1"
              :selected-key="currentLanguage.code"
              :options="languages"
              key-name="name"
              class="lang-dropdown"
              @clicked="selectedLanguage"
            />

            <a
              :href="`mailto:${email}`"
              class="flex gap-5"
            >
              <i
                class="icon email-icon"
              />
              <span>
                <span class="hide-md">{{ $t('home.mail') }}</span>
                {{ email }}
              </span>
            </a>

            <template v-if="phone">
              <span>|</span>
              <a
                :href="`tel:${phone}`"
                class="flex gap-5"
              >
                <i
                  class="icon phone-icon"
                />
                <span><span class="hide-md">{{ $t('home.helpline') }}</span> {{ phone }}</span>
              </a>
            </template>
          </div>

          <div class="flex right-side text-upper">
            <div
              class="flex gap-5"
              v-if="!isLoggedIn"
            >
              <template
                v-if="sellerSignUp"
              >
                <nuxt-link
                  to="/seller/register"
                  class="flex gap-5"
                >
                  {{ $t('date.bav') }}
                </nuxt-link>
                <span>|</span>
              </template>

              <nuxt-link
                to="/login"
                class="flex gap-5"
              >
                <i
                  class="icon login-icon"
                />
                {{ $t('header.login') }}
              </nuxt-link>
              <span>|</span>
              <nuxt-link
                to="/register"
                class="flex gap-5"
              >
                <i
                  class="icon register-icon"
                />
                {{ $t('header.register') }}
              </nuxt-link>
            </div>

            <nuxt-link
              v-else
              to="/user/profile"
              class="flex gap-5"
            >
              <i
                class="icon user-icon"
              />
              {{ $t('header.profile') }}
            </nuxt-link>
          </div>
        </div>
      </div>
    </div>

    <div class="header-sticky" :class="{sticky: headerSticky}">
      <div class="container-fluid flex pos-rel">
        <div class="left-area">
          <nuxt-link
            to="/"
            class="logo"
          >
            <img
              :src="imageURL({'image': site_setting.header_logo})"
              :alt="$t('footer.siteLogo')"
              height="40"
              width="139"
            >
          </nuxt-link>
        </div>

        <form
          class="search-input grow"
          @submit.prevent="search"
        >
          <input
            @focus="openSearchPopup"
            @blur="blurSearchInput"
            type="text"
            :placeholder="$t('header.searchHere')"
            v-model="searchedText"
          >
          <button
            aria-label="submit"
            type="submit"
            class="flex"
          >
            <i
              class="icon search-icon"
            />
          </button>

          <search-popup
            v-if="searchPopup"
            :searched-text="searchedText"
            @close="closeSearchPopup"
          />
        </form>

        <div class="right-area flex gap-15 right">
          <div
            class="pos-rel"
            v-outside-click="closeDropdown"
          >
            <button
              aria-label="submit"
              class="flex gap-10"
              @click="dropdown = !dropdown"
            >
              {{ $t('header.account') }}
              <i
                class="icon arrow-down black"
              />
            </button>
            <div
              class="dropdown"
              :class="{active: dropdown}"
            >
              <nuxt-link
                to="/user/orders"
              >
                {{ $t('header.orders') }}
              </nuxt-link>
              <nuxt-link
                to="/user/wishlists"
              >
                {{ $t('header.wishList') }}
              </nuxt-link>
              <nuxt-link
                to="/user/compared"
              >
                {{ $t('header.comparedList') }}
              </nuxt-link>
              <nuxt-link
                to="/user/vouchers"
              >
                {{ $t('header.vouchers') }}
              </nuxt-link>
              <button
                aria-label="Logout"
                v-show="isLoggedIn"
                class="clear-btn"
                @click.prevent="loggingOut"
              >
                {{ $t('header.logout') }}
              </button>
            </div>
          </div>
          <nuxt-link
            to="/cart"
            class="cart-btn flex pos-rel h-40x gap-5"
          >
            <span
              v-if="cartCount"
              class="cart-badge">
              {{ cartCount }}
            </span>
            <i
              class="icon cart-icon black"
            />
            <span class="title">{{ $t('header.cart') }}</span>
          </nuxt-link>
        </div>
      </div>
      <div class="bottom-area text-nowrap">
        <div class="container-fluid">
          <div class="flex sided">
            <div>
              <nuxt-link
                v-for="(item, index) in headerLeft"
                :key="index"
                :to="getUrl(item)"
              >
                <span>
                  {{ getTitle(item) }}
                </span>
              </nuxt-link>
            </div>
            <div>

              <nuxt-link
                v-for="(item, index) in headerRight"
                :key="index"
                :to="getUrl(item)"
              >
                <span>
                  {{ getTitle(item) }}
                </span>
              </nuxt-link>

            </div>
          </div>
        </div>
      </div>
    </div>
  </header>
</template>
<script>
  import outsideClick from '~/directives/outside-click'
  import util from '~/mixin/util'
  import { mapGetters, mapActions} from 'vuex'
  import SearchPopup from "../../components/SearchPopup";
  import Banner from "../../components/Banner";
  import Dropdown from "../../components/Dropdown";

  export default {
    data() {
      return {
        headerSticky: false,
        topBannerLoaded: false,
        isTopBannerClosed: true,
        dropdown: false,
        searchPopup: false,
        searchFocused: false,
        searchedText: ''
      }
    },
    computed: {
      isXSmallerDevice() {
        return window.innerWidth <= 576
      },
      headerLeft() {
        return this.headerLinks?.left || []
      },
      headerRight() {
        return this.headerLinks?.right || []
      },
      isPublic(){
        return parseInt(this.topBanner?.status) === this.status.PUBLIC
      },
      isLoggedIn(){
        return this.$auth?.loggedIn || false
      },
      cartCountCom(){
        return this.$auth?.user?.cart_count
      },
      username(){
        return this.$auth?.user?.name?.split(' ')[0]
      },
      email(){
        return this.setting?.email
      },
      phone(){
        return this.setting?.phone
      },
      sellerSignUp(){
        return this.setting?.vendor_registration
      },
      ...mapGetters('language', ['languages', 'currentLanguage']),
      ...mapGetters('common', ['site_setting', 'setting', 'topBanner', 'headerLinks']),
      ...mapGetters('listing', ['searched']),
      ...mapGetters('cart', ['cartCount'])
    },
    watch: {
      cartCountCom(value){
        this.setCartCount(value)
      },
      '$route'() {
        this.setQFromRoute()
        this.closeDropdown()
      },
      searchedText(){
        if(!this.searchPopup && this.searchFocused){
          this.emptySearchedSuggestion()
          this.openSearchPopup()
        }
      }
    },
    directives: {outsideClick},
    components: {Dropdown, Banner, SearchPopup},
    mixins: [util],
    methods: {
      handleIntersection(entries) {
        entries.forEach((entry) => {
          this.headerSticky = !entry.isIntersecting
        });
      },
      async selectedLanguage(data){
        document.cookie = 'currentLanguage=' + data.key + '; path=/; expires=' + 365 * 60 * 60 * 24
        location.reload()
      },
      topBannerClosed(){
        localStorage.setItem('topBannerClosed', true)
        this.isTopBannerClosed = true
      },
      openSearchPopup(){
        if(this.searchedText.length > 0){
          this.searchPopup = true
        }
        this.searchFocused = true
      },
      blurSearchInput(){
        this.searchFocused = false
        this.closeSearchPopup()
      },
      closeSearchPopup(){
        setTimeout(() => {
          this.searchPopup = false
        }, 100)
      },
      setQFromRoute(){
        this.searchedText = this.$route?.query?.q || ''
      },
      search(){
        if(this.searchedText && (this.searchedText !== this.searched || this.$route.name !== 'search')){
          this.$router.push({ path: `/search?q=${this.searchedText}`})
          this.updateSearch(this.searchedText)
        }
      },
      async loggingOut(){
        try {
          await this.$auth.logout()
          this.closeDropdown()
          //this.emptyCartProduct()
        } catch (e) {
          return this.$nuxt.error(e)
        }
      },
      closeDropdown() {
        this.dropdown = false
      },
      ...mapActions('language', ['setDefaultLanguage', 'getLangData']),
      ...mapActions('cart', ['emptyCartProduct', 'setCartCount']),
      ...mapActions('listing', ['updateSearch', 'emptySearchedSuggestion']),
    },
    deactivated() {
    },
    activated() {

    },
    mounted() {




      this.setQFromRoute()
      this.updateSearch(this.searchedText)
      if(this.cartCountCom){
        this.setCartCount(this.cartCountCom)
      }

      const self = this
      this.$nextTick(() => {
        if(localStorage.getItem('topBannerClosed') !== null){
          self.isTopBannerClosed = localStorage.getItem('topBannerClosed')
          self.topBannerLoaded = true
        } else {
          self.isTopBannerClosed = false
          self.topBannerLoaded = true
        }
      })


      let rootMargin = '0px 0px 0px 0px'
      if(this.isXSmallerDevice) {
        rootMargin = '40px 0px 0px 0px'
      }


      this.observer = new IntersectionObserver(this.handleIntersection, {
        root: null, // Use the viewport as the root
        rootMargin: rootMargin,
        threshold: 0, // Trigger when 50% of the target is visible
      });

      // Start observing the target element
      this.observer.observe(this.$refs.headerWrapper);
    }
  }
</script>
