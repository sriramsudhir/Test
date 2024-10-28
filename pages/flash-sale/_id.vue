<template>
  <client-only>
    <div class="container-fluid mtb-20 mtb-sm-15">
      <div class="flash-list">
        <div class="tile-container" v-if="!currentItems">
          <div class="shimmer-wrapper">
            <tile-shimmer
              v-for="index in shimmerCount.FLASH_SALE"
              :key="index"
            />
          </div>
        </div>
        <div class="pos-rel" v-else>

          <div
            class="spinner-wrapper flex layer-white"
            v-if="fetchingProductData"
          >
            <spinner
              :radius="100"
            />
          </div>

          <div
            v-if="currentItems && !currentItems.length"
            class="info-msg"
          >
            {{ $t('listingLayout.noProductFound') }}
          </div>

          <div v-else class="tile-container">
            <flash-product-tile
              v-for="(value, index) in currentItems"
              :key="value.id"
              :product="value"
              class="p-tile"
            />
          </div>

          <pagination
            :total-page="totalPage"
            @fetching-data="fetchingData"
          />
        </div>
      </div>

    </div>
  </client-only>
</template>

<script>
  import {mapGetters, mapActions} from 'vuex'
  import util from '~/mixin/util'
  import metaHelper from '~/mixin/metaHelper'
  import routeParamHelper from '~/mixin/routeParamHelper'
  import FlashProductTile from "~/components/FlashProductTile";
  import Pagination from "~/components/Pagination";
  import Spinner from "~/components/Spinner";
  import TileShimmer from "~/components/TileShimmer";
  import global from '~/mixin/global'

  export default {
    middleware: ['common-middleware'],
    components: {TileShimmer, Spinner, Pagination, FlashProductTile},
    head() {
      return {}
    },
    data() {
      return {
        activate: false,
        fetchingProductData: false
      }
    },
    mixins: [util, metaHelper, routeParamHelper, global],
    computed: {
      currentItems() {
        return this.products?.data || null
      },
      totalPage() {
        return this.products?.last_page
      },
      flashId() {
        return this.$route?.params?.id
      },
      ...mapGetters('language', ['langCode']),
      ...mapGetters('flashSale', ['products']),
    },
    methods: {
      async fetchingData() {
        this.fetchingProductData = true
        await setTimeout(async () => {
          try {
            this.settingRouteParam()
            await this.fetchFlashProducts({
                lang: this.langCode,
                params: {
                  id: this.flashId,
                  page: this.page,
                }
              })
            this.fetchingProductData = false
          } catch (e) {
            return this.$nuxt.error(e)
          }
        }, 100)
      },
      ...mapActions('flashSale', ['fetchFlashProducts', 'emptyFlashProducts']),
    },
    async mounted() {
      this.emptyFlashProducts();
      await this.fetchingData()
    }
  }
</script>
