<template>
  <client-only>
    <listing-layout
      :result-title="slugText"
      :product-params="productParams"
    />
  </client-only>
</template>

<script>
  import ListingLayout from "~/components/ListingLayout"
  import util from '~/mixin/util'
  import global from '~/mixin/global'
  import metaHelper from '~/mixin/metaHelper'


  export default {
    middleware: ['common-middleware'],
    head(){
      return {
      }
    },
    components: {
      ListingLayout
    },
    mixins: [util, metaHelper, global],
    computed: {
      slugText() {
        return this.slugToText(this.$route?.params?.main)
      },
      productParams(){
        return this.$route.query
      }
    },
    mounted() {
    }
  }
</script>
