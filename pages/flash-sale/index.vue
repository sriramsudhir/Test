<template>
  <div class="container-fluid mtb-20 mtb-sm-15">
    <flash-sale
      v-if="flashSales && flashSales.length"
      :flash-sales="flashSales"
    />
    <p v-else-if="flashSales" class="info-msg">
      {{ $t('listingLayout.noProductFound') }}
    </p>
  </div>
</template>

<script>
  import {mapGetters, mapActions} from 'vuex'
  import FlashSale from "~/components/FlashSale";
  import global from '~/mixin/global'

  export default {
    middleware: ['common-middleware'],
    components: {FlashSale},
    head(){
      return {
      }
    },
    data() {
      return {
      }
    },
    mixins: [global],
    computed: {
      ...mapGetters('language', ['langCode']),
      ...mapGetters('home', ['flashSales']),
    },
    methods: {
      ...mapActions('flashSale', ['fetchFlashSales']),
    },
    async mounted() {
      if(!this.flashSales){
        try {


          await this.fetchFlashSales({lang: this.langCode })
        }catch (e) {
          return this.$nuxt.error(e)
        }
      }
    }
  }
</script>
