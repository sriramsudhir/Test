<template>
  <div>
    <product-list
      :result-title="subCategoryTitle"
      :slugs="slug"
      :has-breadcrumb="true"
      :fetching-product-data="fetchingResult"
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
        fetchingResult: false,
        subCategory: null,
      }
    },
    components: {
      ProductList
    },
    head(){
      return {
        productList: null,
        title: this.subCategory?.meta_title,
        meta: [
          this.generatingMeta('description', this.subCategory?.meta_description),
          this.generatingMeta('keywords', this.subCategory?.meta_keywords),
          this.generatingMeta('og:image', this.imageURL(this.subCategory)),
          this.generatingMeta('og:title', this.subCategory?.meta_title),
          this.generatingMeta('og:description', this.subCategory?.meta_description)
        ]
      }
    },
    mixins: [util, metaHelper, listingParams, global],
    computed: {
      currentItems() {
        return this.products?.data || null
      },
      subCategoryTitle(){
        return this.subCategory?.title
      },
      currentCategory(){
        return this.subCategory?.category
      },
      slug(){
       return [{
          title: this.currentCategory?.title,
          link: this.categoryLink(this.currentCategory)
        }]
      },
      ...mapGetters('listing', ['brands', 'shippingRules', 'collections', 'products']),
    },
    async asyncData({ store, error, route }){
      try {
        const listing = store.state.listing

        const data = await store.dispatch('common/getRequest', {
          params: {
            sub_category: route?.params?.subCategory,

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


        if(data?.status !== 200) {
          return error({ statusCode: 404, message: i18n.t('categoryListingLayout.noItemFound') })
        }
        store.commit('listing/SET_PRODUCTS', data)

        return {

          subCategory: data.data.sub_category
        }
      } catch (e) {
        error(e)
      }
    },
    methods:{
      async fetchingData() {
        this.fetchingResult = true
        this.emptyProducts()

        try {
          setTimeout(async () => {

            const data = await this.getRequest({
              params: {
                  sub_category: this.$route?.params?.subCategory,
                  sortby: this.sortByData,
                  shipping: this.shippingFromRoute,
                  brand: this.brandFromRoute,
                  collection: this.collectionFromRoute,
                  rating: this.ratingFromRoute,
                  max: this.maxPriceFromRoute,
                  min: this.minPriceFromRoute,
                  page: this.pageData,
                  sidebar_data: !this.brands || !this.shippingRules ||  !this.collections
              },
              api: 'all'
            })

            this.fetchingResult = false
            this.setProducts(data)
          }, 100)
        } catch (e) {
          return this.$nuxt.error(e)
        }
      },
      ...mapActions('listing', ['emptyProducts', 'setProducts']),
      ...mapActions('common', ['getRequest'])
    },
    async mounted() {

    },
  }
</script>
