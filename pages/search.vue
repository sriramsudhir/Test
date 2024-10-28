<template>
    <listing-layout
      :result-title="searchedKeyword"
      ref="productListElem"
    />
</template>

<script>
  import {mapGetters, mapActions} from 'vuex'
  import util from '~/mixin/util'
  import metaHelper from '~/mixin/metaHelper'
  import ListingLayout from "~/components/ListingLayout";
  import global from '~/mixin/global'


  export default {
    middleware: ['common-middleware'],
    name: 'search',
    components: {ListingLayout},
    head(){
      return {
      }
    },
    data() {
      return {
      }
    },
    mixins: [util, metaHelper, global],
    watch: {
      async searched(){

          try{
            this.$refs.productListElem.clearQuery()
            await this.$refs.productListElem.fetchingData()

          }catch (e) {
            console.log(e)
          }

      }
    },
    computed: {
      searchedKeyword(){
        return this.$route.query?.q || ''
      },
      ...mapGetters('listing', ['searched']),
    },
    methods: {
      async loadData() {
        setTimeout(async ()=>{
          await this.$refs.productListElem.fetchingData()
        }, 200)
      },
      ...mapActions('listing', ['emptyProducts'])
    },
    mounted() {
      this.emptyProducts()
    }
  }
</script>

<style>

</style>
