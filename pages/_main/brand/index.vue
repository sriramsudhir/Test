<template>
  <listing-layout
    :product-params="productParams"
  />
</template>

<script>
  import ListingLayout from "~/components/ListingLayout"
  import util from '~/mixin/util'
  import metaHelper from '~/mixin/metaHelper'
  import global from '~/mixin/global'

  export default {
    middleware: ['common-middleware'],
    mixins: [util, metaHelper, global],
    components: {
      ListingLayout
    },
    computed: {
      productParams(){
        return {'brand': this.$route?.params?.id}
      }
    },
    mounted() {
    }
  }
</script>
