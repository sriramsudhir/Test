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
    head(){
      return {
        title: this.slugToText(this.$route?.params?.main || ''),
      }
    },
    components: {
      ListingLayout
    },
    mixins: [util, metaHelper, global],
    computed: {
      productParams(){
        return {'collection': this.$route?.params?.id}
      }
    },
    mounted() {
    }
  }
</script>
