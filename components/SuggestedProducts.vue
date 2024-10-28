<template>
  <transition name="fade" mode="out-in">
    <div v-if="!fetchingSuggested">
      <products-dynamic
        v-if="suggested1.length"
        :title="$t('suggestedProducts.recommendedForYou')"
        :item-list="suggested1"
        :per-page="perPageSuggested1"
        :total-item="totalSuggested1"
        @change="change(1, $event)"
        class="b-t pt-20 pt-sm-15 npb-5"
      />

      <products-dynamic
        v-if="suggested2.length"
        :title="$t('suggestedProducts.alsoViewed')"
        :item-list="suggested2"
        :total-item="totalSuggested2"
        :per-page="perPageSuggested2"
        @change="change(2, $event)"
        class="b-t pt-20 pt-sm-15 pb-15 pb-sm-5"
      />
    </div>
    <div
      class="spinner-wrapper flex "
      v-else
    >
      <spinner
        :radius="100"
      />
    </div>

  </transition>
</template>

<script>
  import { mapGetters } from 'vuex'
  import util from '~/mixin/util'
  import ProductsSlider from '~/components/ProductsSlider'
  import Spinner from "./Spinner";
  import ProductsDynamic from "~/components/ProductsDynamic";
  export default {
    name: 'SuggestedProducts',
    data() {
      return {
        fetchingSuggested: true,
        lastPage: 1,
        currentPage: 1,
        totalSuggested1: 0,
        totalSuggested2: 0,
        perPageSuggested1: 0,
        perPageSuggested2: 0,
        suggested1: [],
        suggested2: [],
        loaded: []
      }
    },
    watch: {},
    props: {
      productId: {
        type: String,
        default: ''
      },
    },
    components: {ProductsDynamic, Spinner, ProductsSlider },
    computed: {
      ...mapGetters('language', ['langCode']),
      ...mapGetters('detail', ['suggested']),
    },
    mixins: [util],
    methods: {
      async fetchSuggested(page, type = 0) {
        if(type === 1){
          this.suggested1 = this.suggested1.concat(['', '', '', '', ''])
        }else if(type === 2) {
          this.suggested2 = this.suggested2.concat(['', '', '', '', ''])
        }else{
          this.suggested1 = this.suggested1.concat(['', '', '', '', ''])
          this.suggested2 = this.suggested2.concat(['', '', '', '', ''])
        }

        try {
          this.loaded.push(page)
          await this.$store.dispatch('detail/fetchSuggestedProducts', {
            id: this.productId,
            page: page,
            lang: this.langCode,
          })
          this.fetchingSuggested = false
        } catch (e) {
          return this.$nuxt.error(e)
        }

        if(type === 1){
          this.suggested1.splice(this.suggested1.length - 5, 5)
        }else if(type === 2) {
          this.suggested2.splice(this.suggested2.length - 5, 5)
        }else{
          this.suggested1.splice(this.suggested1.length - 5, 5)
          this.suggested2.splice(this.suggested2.length - 5, 5)
        }


        if(this.suggested?.suggestion_1?.data){
          this.suggested1 = this.suggested1.concat(this.suggested?.suggestion_1?.data)
        }

        if(this.suggested?.suggestion_2?.data){
          this.suggested2 = this.suggested2.concat(this.suggested?.suggestion_2?.data)
        }


        if(page === 1){

          const total1 = this.suggested?.suggestion_1?.total
          const perPage1 = this.suggested?.suggestion_1?.per_page
          const lastPage1 = this.suggested?.suggestion_1?.last_page

          if(total1 < perPage1){
            this.totalSuggested1 = lastPage1 * perPage1
           // this.totalSuggested1 = total1
          }else {
            this.totalSuggested1 = total1
          }

          const total2 = this.suggested?.suggestion_2?.total
          const perPage2 = this.suggested?.suggestion_2?.per_page
          const lastPage2 = this.suggested?.suggestion_2?.last_page

          if(total2 < perPage2){
            //this.totalSuggested2 = lastPage2 * perPage2
            this.totalSuggested2 = total2
          }else {
            this.totalSuggested2 = total2
          }

          this.perPageSuggested1 = perPage1
          this.perPageSuggested2 = perPage2

          const lastPageSug1 = lastPage1 ?? 0
          const lastPageSug2 = lastPage2 ?? 0
          if(lastPageSug2 > lastPageSug1){
            this.lastPage = lastPageSug2
          }else{
            this.lastPage = lastPageSug1
          }
        }
      },
      async change(type, evt){
        this.currentPage += evt

        if(this.currentPage < 1){
          this.currentPage = this.lastPage
        }else if(this.currentPage > this.lastPage){
          this.currentPage = 1
        }
        if(this.loaded.indexOf(this.currentPage) === -1){
          await this.fetchSuggested(this.currentPage, type)
        }
      }
    },
    created() {
    },
    async mounted() {
      await this.fetchSuggested(this.currentPage)
    }
  }
</script>

