<template>
  <div>
    <div class="detail-menu">
      <div class="container-fluid">
        <div class="list-heading flex sided">
          <p
            class="hide-sm"
          >
            {{ pageHeading }}
            <span
              v-if="resultTitle"
            >
              {{ $t('listingLayout.for') }}
              <span class="bold">
                "{{ resultTitle }}"
              </span>
            </span>
          </p>
          <div class="flex gap-5">
            <span class="hide-sm">
              {{ $t('listingLayout.sortBy') }}
            </span>
            <client-only>
              <dropdown
                class="sort-dropdown"
                :options="sortingOptions"
                :selected-key="sortby"
                @clicked="selectedSorting"
              />

              <button
                v-show="isXsDevice"
                class="filter-btn flex outline-btn plr-20"
                aria-label="submit"
                @click.prevent="openFilter"
              >
                {{ $t('listingLayout.filter') }}
                <span
                  v-if="filteredCount"
                >
                  ({{ filteredCount }})
                </span>
                <i
                  class="icon black"
                  :class="[{'arrow-up': filterPopup}, {'arrow-down': !filterPopup}]"
                />
              </button>
            </client-only>
          </div>
        </div>
      </div>
    </div>

    <div class="container-fluid mtb-20 mtb-sm-15">
      <div
        class="product-list"
      >
        <div
          v-show="filterPopup"
          class="left-area"
        >
            <div
              @click.prevent="closeFilter"
              class="layer"
            />
            <div class="sticky">
              <div class="close-btn-wrapper">
                <button
                  aria-label="submit"
                  @click.prevent="closeFilter"
                >
                  {{ $t('listingLayout.close') }}
                </button>
              </div>
                <div class="sidebar">

                  <button
                    v-if="backBtn"
                    @click.prevent="goingBack" class="flex start mb-15 clear-btn">
                    <span class="flex">
                      <i class="dimen-16x icon double-arrow-left-icon mr-5 opacity-6"></i>
                      {{ $t('date.gb') }}
                    </span>
                  </button>

                  <filter-category
                    ref="filterCategory"
                    :categories="categories"
                    @going-next="goingNext"
                  />
                  <filter-price
                    ref="filterPrice"
                    @reset-route="changeRoute"
                  />
                  <filter-rating
                    ref="filterRating"
                    @reset-route="changeRoute"
                  />
                  <filter-brand
                    ref="filterBrand"
                    :brands="brands"
                    @reset-route="changeRoute"
                  />
                  <filter-collection
                    ref="filterCollection"
                    :collections="collections"
                    @reset-route="changeRoute"
                  />
                  <filter-shipping
                    ref="filterShipping"
                    :shipping-rules="shippingRules"
                    @reset-route="changeRoute"
                  />
                </div>
              </div>
          </div>

          <div class="main-content">
            <breadcrumb
              v-if="hasBreadcrumb"
              class="mb-15 mt-0"
              :page="resultTitle"
              :slugs="slugs"
            />
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
            <div
              class="pos-rel"
              v-else
            >
              <div
                v-if="(currentItems && !currentItems.length)"
                class="info-msg"
              >
                {{ $t('listingLayout.noProductFound') }}
              </div>

              <p class="hide block-sm ml-10 ml-xs-5 mb-10">{{ pageHeading }}
                <span v-if="resultTitle" class="bold">"{{ resultTitle }}"</span>
              </p>

              <div
                class="tile-container"
              >
                <product-tile
                  v-for="(value, index) in currentItems"
                  :key="index"
                  :product="value"
                />
              </div>

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
  import Pagination from '~/components/Pagination'
  import {mapGetters, mapActions} from 'vuex'
  import util from '~/mixin/util'
  import routeParamHelper from '~/mixin/routeParamHelper'
  import Dropdown from '~/components/Dropdown'
  import FilterPrice from "./FilterPrice";
  import FilterCategory from "./FilterCategory";
  import TileShimmer from "./TileShimmer";
  import Spinner from "./Spinner";
  import ProductTile from "./ProductTile";
  import FilterRating from "./FilterRating";
  import FilterBrand from "./FilterBrand";
  import FilterCollection from "./FilterCollection";
  import FilterShipping from "./FilterShipping";
  import Breadcrumb from "./Breadcrumb";

  export default {
    name: 'ProductList',
    data() {
      return {
        loaded: false,
        filterPopup: true,
        sortingOptions: {
          featured: {title: this.$t('featured.featured') },
          price_low_to_high: {title: this.$t('listingLayout.priceLowToHigh') },
          price_high_to_low: {title: this.$t('listingLayout.priceHighToLow') },
          avg_customer_review: {title: this.$t('listingLayout.avgCustomerReview') },
        },
        sortby: this.$route.query.sortby || '',
      }
    },
    mixins: [util, routeParamHelper],
    watch: {},
    props: {

      categories: {
        type: Array,
        default: []
      },
      backBtn: {
        type: Boolean,
        default: true
      },

      hasBreadcrumb: {
        type: Boolean,
        default: false
      },
      slugs: {
        type: Array,
        default() {
          return []
        }
      },
      fetchingProductData: {
        type: Boolean,
        default: false
      },
      productParams: {
        type: Object,
        default() {
          return {}
        }
      },
      resultTitle: {
        type: String,
        default: ''
      },
    },
    components: {
      Breadcrumb,
      FilterShipping,
      FilterCollection,
      FilterBrand,
      FilterRating,
      ProductTile,
      Spinner,
      TileShimmer,
      FilterCategory,
      FilterPrice,
      Pagination,
      Dropdown
    },
    computed: {
      filteredCount(){
        let count = 0
          if(this.shippingFromRoute){
            count++
          }
          if(this.ratingFromRoute){
            count++
          }
          if(this.minPriceFromRoute){
            count++
          }
          if(this.maxPriceFromRoute){
            count++
          }
        return count
      },
      isXsDevice() {
        if(process?.browser){
          return window.innerWidth <= 576
        }
       return false
      },
      pageHeading() {
        if (this.products) {
          if(this.products?.total > 0) {
            return this.$t('listingLayout.paginationResult', {
              from: this.products?.from,
              to: this.products?.to,
              total: this.products?.total
            })
          }

          //return this.$t('listingLayout.noProductFound')
        }
        return this.$t('listingLayout.showingResult')
        //return `${this.$t('listingLayout.loading')}...`
      },
      currentItems() {
        return this.products?.data || null
      },
      totalPage() {
        return this.products?.last_page
      },
      ...mapGetters('common', ['currencyIcon', 'setting']),
      ...mapGetters('listing', ['products', 'brands', 'shippingRules', 'collections']),
    },
    methods: {
      goingBack() {
        this.$router.go(-1)
      },
      openFilter() {
        this.filterPopup = true
        document.body.classList.add('no-scroll')
      },
      closeFilter() {
        this.filterPopup = false
        document.body.classList.remove('no-scroll')
      },
      selectedSorting(data) {
        if(this.sortby){
          let filtered = Object.assign({}, this.$route.query)
          filtered = {...filtered, ...{sortby: data.key } }

          this.$refs.productPagination?.resettingRoute(filtered)
          //this.fetchingData()

        }
        this.sortby = data.key
      },
      clearSortby() {
        this.sortby = 'featured'
      },
      clearQuery(){
        this.$refs.filterPrice?.clearPrice()
        this.$refs.filterShipping?.clearShipping()
        this.clearSortby()
        this.$refs.filterRating?.clearRating()
        if(this.isXsDevice){
          this.closeFilter()
        }
      },
      changeRoute(evt){
        this.$refs.productPagination?.resettingRoute(evt)
        //this.$emit('fetch-data')
      },
      goingNext(url) {
        this.clearQuery()
        if(url === this.$route.path){

          this.$router.push({
            query: {}
          })
          this.$emit('fetch-data')
        } else {
          this.$router.push({path: url})
        }
      },
      fetchingData() {
        // this.settingRouteParam()
        this.$emit('fetch-data')
      },
    },
    destroyed() {
      if(this.isXsDevice && this.filterPopup) {
        this.closeFilter()
      }
    },
    async mounted() {
      this.$nextTick(function() {
        if(this.isXsDevice && this.filterPopup) {
          this.closeFilter()
        }
      })
    }
  }
</script>
