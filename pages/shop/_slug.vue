<template>
  <div>
    <div class="store-container mb-30 mb-sm-15">
      <div class="container-fluid">

        <div class="store-info">
          <div class="left-area">
            <div class="img-wrap">
              <img
                :src="imageURL(store)"
                :alt="$t('footer.siteLogo')"
                height="50"
                width="50"
              >
            </div>

            <div class="store-content">

              <div>
                <h4 class="bold mb-5">{{store.name}}</h4>
                <h6 v-if="review" class="store-rating ls-0">{{$t('store.avgRating')}} <b class="f-12 ml-5">{{formatPrice(review)}}</b></h6>
              </div>

              <div>
                <p class="opacity-8 f-9">{{$t('store.memberSince')}}</p>
                <h6 class=""><b>{{storeDate}}</b></h6>
              </div>

            </div>
          </div>
          <div class="right-area">

            <follow-btn
              class="primary-btn w-150x"
              :following="following"
              :store-id="storeId"
              @change-following="following = !following"
            />
          </div>
        </div>
      </div>
    </div>

    <div class="container-fluid mb-50 mb-sm-20">


      <div class="flex sided mb-15">
        <breadcrumb
          class="mtb-0"
          :page="store.name"
        />

        <sort-by
          @fetching-data="shortByChanged"
        />
      </div>

      <div class="main-content">

        <div
          v-if="fetchingProductData"
          class="tile-container"
        >
          <div class="shimmer-wrapper">
            <tile-shimmer
              v-for="index in 20"
              :key="index"
            />
          </div>
        </div>
        <div class="pos-rel" v-else>

          <div
            v-if="(currentItems && !currentItems.length)"
            class="info-msg"
          >
            {{ $t('listingLayout.noProductFound') }}
          </div>

          <div
            class="tile-container"
          >
            <product-tile
              v-for="(value, index) in currentItems"
              :key="index"
              :product="value"
            />
          </div>


          <div class="flow-hidden">
            <pagination
              class="mt-30"
              ref="productPagination"
              :total-page="totalPage"
              @fetching-data="fetchingData"
            />
          </div>

        </div>
      </div>
    </div>
  </div>
</template>

<script>
  import {mapGetters, mapActions} from 'vuex'
  import util from '~/mixin/util'
  import metaHelper from '~/mixin/metaHelper'
  import Pagination from "~/components/Pagination";
  import Breadcrumb from "~/components/Breadcrumb";
  import TileShimmer from "~/components/TileShimmer";
  import AjaxButton from "~/components/AjaxButton";
  import listingParams from "~/mixin/listingParams";
  import moment from "moment";
  import SortBy from "~/components/SortBy";
  import ProductTile from "~/components/ProductTile";
  import FollowBtn from "~/components/FollowBtn";
  import global from '~/mixin/global'

  export default {
    middleware: ['common-middleware'],
    data() {
      return {
        result: null,
        fetchingProductData: false
      }
    },
    components: {
      FollowBtn,
      ProductTile,
      SortBy,
      AjaxButton,
      TileShimmer,
      Breadcrumb,
      Pagination
    },
    head() {
      return {
        title: this.store?.meta_title,
        meta: [
          this.generatingMeta('description', this.store?.meta_description),
          this.generatingMeta('keywords', this.store?.meta_keywords),
          this.generatingMeta('og:image', this.imageURL(this.store)),
          this.generatingMeta('og:title', this.store?.meta_title),
          this.generatingMeta('og:description', this.store?.meta_description)
        ]
      }
    },
    mixins: [util, metaHelper, listingParams, global],
    computed: {
      storeId(){
        return this.store?.id
      },
      storeDate() {
        return moment(this?.store?.created_at).format('MMM DD, YYYY')
      },
      currentItems() {
        return this.products?.data || null
      },
      totalPage() {
        return this.products?.last_page
      },
      ...mapGetters('language', ['langCode']),
    },
    async asyncData({store, error, route, i18n}) {
      try {

        const data = await store.dispatch('common/ssrGetRequest', {
          params: {
            slug: route?.params?.slug,
            sortby: route.query.sortby || '',
            page: route.query.page || '',
            required_rating: true
          },
          api: 'store',
          lang: store.state.language.langCode,
          requiredToken: true
        })

        if (data?.status !== 200) {
          return error({statusCode: 404, message: i18n.t('categoryListingLayout.noItemFound')})
        }
        return {
          review: data?.data?.review,
          following: data?.data?.following,
          products: data?.data?.result,
          store: data?.data?.store
        }

      } catch (e) {
        error(e)
      }
    },
    methods: {
      shortByChanged(filtered){
        this.$refs.productPagination?.resettingRoute(filtered)
      },
      async fetchingData() {
        this.fetchingProductData = true
        const self = this

        try {
          setTimeout(async () => {
            const data = await this.getRequest({
              params: {
                slug: this.$route?.params?.slug,
                sortby: this.sortByData,
                page: this.pageData,
              },
              api: 'store',
              lang: this.langCode,
            })

            self.products = data?.data?.result
            self.fetchingProductData = false
          }, 100)

        } catch (e) {
          return this.$nuxt.error(e)
        }
      },
      ...mapActions('common', ['ssrGetRequest', 'getRequest', 'postRequest']),
    },
    async mounted() {


    },
  }
</script>

<style>

</style>
