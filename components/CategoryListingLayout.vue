<template>
  <client-only>
    <div class="container-fluid ptb-20 ptb-sm-15 flow-hidden">
      <div class="mlr--5">
      <div
        v-if="fetchingCategoryData"
        class="tile-container category-tile-wrapper"
      >
        <div class="shimmer-wrapper">
          <tile-shimmer
            class="category-tile"
            v-for="index in shimmerCount.PRODUCT"
            :key="index"
          />
        </div>
      </div>
      <div
        v-else
        class="pos-rel"
      >
        <div
          v-if="!currentItems.length"
          class="info-msg"
        >
          {{ $t('categoryListingLayout.noItemFound') }}
        </div>
        <div
          v-else
        >
          <div
            v-if="isBrandPage"
            class="category-tile-wrapper"
          >
            <brand-tile
              class="category-tile"
              v-for="(value, index) in currentItems"
              :key="index"
              :brand="value"
            />
          </div>

          <div
            v-else
            class="category-tile-wrapper"
          >
            <sub-category-tile
              class="category-tile"
              v-for="(value, index) in currentItems"
              :key="index"
              :sub-category="value"
              :category="subCategoriesMap[value.id]"
            />
          </div>

        </div>
        <pagination
          class="mt-15 mt-sm-10"
          :total-page="totalPage"
          @fetching-data="fetchingData"
        />
      </div>
    </div>
    </div>
  </client-only>
</template>
<script>
  import { mapGetters, mapActions } from 'vuex'
  import util from '~/mixin/util'
  import metaHelper from '~/mixin/metaHelper'
  import routeParamHelper from '~/mixin/routeParamHelper'
  import LazyImage from "../components/LazyImage";
  import TileShimmer from "./TileShimmer";
  import CategoryTile from "./CategoryTile";
  import Pagination from "./Pagination";
  import Spinner from "./Spinner";
  import BrandTile from "./BrandTile";
  import SubCategoryTile from "./SubCategoryTile";
  export default {
    components: {
      SubCategoryTile,
      BrandTile,
      Spinner,
      Pagination,
      CategoryTile,
      TileShimmer,
      LazyImage
    },
    data() {
      return {
        result: null,
        fetchingCategoryData: true
      }
    },
    props: {
      subCategoriesMap: {
        type: Object,
        default: null
      },
    },
    mixins: [util, metaHelper, routeParamHelper],
    computed: {
      isBrandPage(){
        return this.$route?.name?.includes('brands')
      },
      currentItems() {
        return this.result?.data || []
      },
      totalPage() {
        return this.result?.last_page
      },
      ...mapGetters('language', ['langCode']),
    },
    methods: {
      async fetchingData() {
        this.fetchingCategoryData = true
        const self = this
        await setTimeout(async () => {
          try {
            self.settingRouteParam()

            let apiName = 'categories'
            if(self.isBrandPage){
              apiName = 'brands'
            }

            const data = await self.getRequest({
              params: {
                page: this.page
              },
              lang: this.langCode,
              api: apiName
            })

            self.result = data?.data

            self.fetchingCategoryData = false

          } catch (e) {
            return self.$nuxt.error(e)
          }
        }, 100)
      },
      ...mapActions('common', ['getRequest']),
      ...mapActions('category', ['emptyCategories'])
    },
    async mounted() {
      this.emptyCategories()
      await this.fetchingData()
    }
  }
</script>
