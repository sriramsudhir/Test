export default {
    computed: {
      pageData() {
        return this.$route.query.page || ''
      },
      sortByData() {
        return this.$route.query.sortby || ''
      },
      searchedKeyword() {
        return this.$route.query.q || ''
      },
      ratingFromRoute() {
        return this.$route.query.rating || 0
      },
      brandFromRoute() {
        return this.$route.query.brand || ''
      },
      collectionFromRoute() {
        return this.$route.query.collection || ''
      },
      shippingFromRoute() {
        return this.$route.query.shipping || ''
      },
      minPriceFromRoute() {
        if(!isNaN(this.$route?.query?.min)){
          return this.$route?.query?.min || 0
        }
        return 0
      },
      maxPriceFromRoute() {
        if(!isNaN(this.$route?.query?.max)){
          return this.$route?.query?.max || 0
        }
        return 0
      },
    }
}
