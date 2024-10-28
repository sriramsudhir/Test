<template>
  <div>
    <product-list
      :result-title="category.title"
      :has-breadcrumb="true"
      :categories="[category]"
      :fetching-product-data="fetchingProductData"
      @fetch-data="fetchingData"
    />
  </div>
</template>
<script>
  import metaHelper from '~/mixin/metaHelper'
  import ProductList from "~/components/ProductList";
  import util from '~/mixin/util'
  import listingParams from '~/mixin/listingParams'
  import {mapGetters, mapActions} from 'vuex'
  import global from '~/mixin/global'

  export default {
    middleware: ['common-middleware'],
    data() {
      return {
        fetchingProductData: false
      }
    },
    components: {
      ProductList
    },
    head(){
      return {
        productList: null,
        title: this.category?.meta_title,
        meta: [
          this.generatingMeta('description', this.category?.meta_description),
          this.generatingMeta('keywords', this.category?.meta_keywords),
          this.generatingMeta('og:image', this.imageURL(this.category)),
          this.generatingMeta('og:title', this.category?.meta_title),
          this.generatingMeta('og:description', this.category?.meta_description)
        ]
      }
    },
    mixins: [util, metaHelper, listingParams, global],
    computed: {
      ...mapGetters('listing', ['brands', 'shippingRules', 'collections', 'categoryData']),
    },
    async asyncData({ store, error, route, i18n  }){
      try {

        const listing = store.state.listing

        const data = await store.dispatch('common/getRequest', { params: {
            category: route?.params?.category,
            sortby: route.query.sortby || '',
            shipping: route.query.shipping || '',
            brand: route.query.brand || '',
            collection: route.query.collection || '',
            rating: route.query.rating || 0,
            max: route?.query?.max || 0,
            min: route?.query?.min || 0,
            page: route.query.page || '',

            sidebar_data: !listing.brands || !listing.shippingRules ||  !listing.collections
          },
          api: 'all',
          lang: store.state.language.langCode
        })

        if(data?.status !== 200){
          return error({ statusCode: 404, message: i18n.t('categoryListingLayout.noItemFound') })
        }


        store.commit('listing/SET_PRODUCTS', data)

        return {
          category: data?.data?.category
        }

      } catch (e) {
        error(e)
      }
    },
    methods:{
      async fetchingData() {

        this.fetchingProductData = true
        const self = this

        try {
          setTimeout(async () => {
            if(this.$route.params.category !== this.category.slug){
              return
            }

            this.emptyProducts()

            const data = await this.getRequest({params: {
                category: this.$route?.params?.category,
                sortby: this.sortByData,
                shipping: this.shippingFromRoute,
                brand: this.brandFromRoute,
                collection: this.collectionFromRoute,
                rating: this.ratingFromRoute,
                max: this.maxPriceFromRoute,
                min: this.minPriceFromRoute,
                page: this.pageData,
                sidebar_data: !this.brands || !this.shippingRules ||  !this.collections
              }, api: 'all'
            })

            self.setProducts(data)
            self.fetchingProductData = false
          }, 200)

        } catch (e) {
          return this.$nuxt.error(e)
        }
      },
      ...mapActions('listing', ['emptyProducts', 'setProducts']),
      ...mapActions('common', ['getRequest']),
    },
    async mounted() {

    },
  }
</script>
