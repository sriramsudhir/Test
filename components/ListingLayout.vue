<template>
  <product-list
    ref="productList"
    :categories="allCategories"
    :result-title="sourceTitle || resultTitle"
    :product-params="productParams"
    :back-btn="false"
    :fetching-product-data="fetchingProductData"
    @fetch-data="fetchingData"
  />

</template>

<script>
  import listingParams from '~/mixin/listingParams'
  import {mapGetters, mapActions} from 'vuex'

  import ProductList from "./ProductList";

  export default {
    name: 'ListingLayout',
    data() {
      return {
        sourceTitle: "",
        products: null,
        fetchingProductData: false,
      }
    },
    mixins: [listingParams],
    watch: {},
    props: {
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
      ProductList
    },
    computed: {
      ...mapGetters('language', ['langCode']),
      ...mapGetters('listing', ['brands', 'shippingRules', 'collections', 'allCategories']),
    },
    methods: {
      clearQuery() {
        this.$refs.productList.clearQuery()
      },
      async fetchingData() {
        this.fetchingProductData = true

          setTimeout(async () => {
            try {


              const data = await this.getRequest({
                params: {
                  ...this.productParams,
                  ...{
                    sortby: this.sortByData,
                    shipping: this.shippingFromRoute,
                    brand: this.brandFromRoute,
                    collection: this.collectionFromRoute,
                    rating: this.ratingFromRoute,
                    max: this.maxPriceFromRoute,
                    min: this.minPriceFromRoute,
                    q: this.searchedKeyword,
                    page: this.pageData,
                    all_categories: !this.allCategories,
                    sidebar_data: !this.brands || !this.shippingRules || !this.collections
                  }
                },
                lang: this.langCode,
                api: 'products'
              })

              this.sourceTitle = data.data?.source?.title



              this.setProducts(data)

              this.products = data.data.result
              this.fetchingProductData = false


            } catch (e) {

              return this.$nuxt.error(e)
            }

          }, 100)


      },
      ...mapActions('listing', ['setProducts', 'emptyProducts']),
      ...mapActions('common', ['getRequest']),
    },
    async mounted() {
      this.emptyProducts()
      await this.fetchingData()
    }
  }
</script>
