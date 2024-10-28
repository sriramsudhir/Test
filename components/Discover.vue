<template>
  <div
    class="home-section"
  >
    <div class="area">
      <h4 class="title">
        {{ $t('discover.dailyDiscover') }}
      </h4>
      <div
        class="area-content"
      >
        <div class="tile-container">
          <transition name="fade" mode="out-in">
            <div
              class="shimmer-wrapper"
              v-if="loading"
              key="shimmer"
            >
              <tile-shimmer
                v-for="index in 15"
                :key="index"
              />
            </div>
            <div
              v-else
              class="flex wrap align-start discover-area"
              key="products"
            >
              <product-tile
                v-for="(value, index) in currentItems"
                :key="index"
                :product="value"
              />
            </div>
          </transition>
        </div>
      </div>
    </div>
    <div
      class="center-text mt-20 mt-sm-15"
    >
      <router-link
        :to="listingLink({slug: 'daily-discover'})"
        class="w-100 br-primary outline-btn btn-lg plr-35 plr-sm-20"
      >
        {{ $t('discover.showMore') }}
      </router-link>
    </div>
  </div>
</template>

<script>
  import {mapActions, mapGetters} from 'vuex'
  import util from '~/mixin/util'
  import TileShimmer from "./TileShimmer";
  import ProductTile from "./ProductTile";

  export default {
    name: 'Discover',
    data() {
      return {
        currentItems: [],
        loading: true
      }
    },
    watch: {},
    props: {},
    components: {ProductTile, TileShimmer},
    computed: {
      ...mapGetters('language', ['langCode']),
      ...mapGetters('home', ['products'])
    },
    mixins: [util],
    methods: {
      ...mapActions('home', ['fetchProducts']),
    },
    created() {
    },
    async mounted() {
      if(!this.products){
        try {
          this.loading = true
          const {data} = await this.fetchProducts({
            payload: {is_home_page: true},
            lang: this.langCode
          })
          this.currentItems = data
          this.loading = false

        } catch (e) {
          return this.$nuxt.error(e)
        }
      } else {

        this.currentItems = this.products?.data
        this.loading = false
      }
    }
  }
</script>
