<template>
  <div class="flex gap-10">
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
    </client-only>
  </div>

</template>

<script>

  import util from '~/mixin/util'
  import routeParamHelper from '~/mixin/routeParamHelper'
  import Dropdown from '~/components/Dropdown'

  export default {
    name: 'SortBy',
    data() {
      return {
        filterPopup: true,
        sortingOptions: {
          featured: {title: this.$t('featured.featured')},
          price_low_to_high: {title: this.$t('listingLayout.priceLowToHigh')},
          price_high_to_low: {title: this.$t('listingLayout.priceHighToLow')},
          avg_customer_review: {title: this.$t('listingLayout.avgCustomerReview')},
        },
        sortby: this.$route.query.sortby || '',
      }
    },
    mixins: [util, routeParamHelper],
    watch: {},
    props: {
    },
    components: {
      Dropdown
    },
    computed: {
      filteredCount() {
        let count = 0
        if (this.shippingFromRoute) {
          count++
        }
        if (this.ratingFromRoute) {
          count++
        }
        if (this.minPriceFromRoute) {
          count++
        }
        if (this.maxPriceFromRoute) {
          count++
        }
        return count
      },
      isXsDevice() {
        if (process.browser) {
          return window.innerWidth <= 576
        }
        return false
      },
    },
    methods: {
      openFilter() {
        this.filterPopup = true
        document.body.classList.add('no-scroll')
      },
      closeFilter() {
        this.filterPopup = false
        document.body.classList.remove('no-scroll')
      },
      selectedSorting(data) {
        if (this.sortby) {
          let filtered = Object.assign({}, this.$route.query)
          filtered = {...filtered, ...{sortby: data.key}}
          this.$emit('fetching-data', filtered)

        }
        this.sortby = data.key
      },
      clearSortby() {
        this.sortby = 'featured'
      },
    },
    async mounted() {
      if (this.isXsDevice) {
        this.filterPopup = false
      }

    }
  }
</script>
