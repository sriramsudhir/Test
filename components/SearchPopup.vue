<template>
  <div class="search-popup">
    <div class="sb popup-inner">
      <div class="pop-over-content ">

        <div
          class="spinner-wrapper flex layer-white"
          v-if="fetchingData"
        >
          <spinner
            :radius="100"
          />
        </div>

        <div
          v-else-if="matchedResult"
        >
          <div
            v-if="suggested.length"
            class="mb-15"
          >
            <h4 class="bold">
              {{ $t('searchPopup.suggestedSearch') }}
            </h4>
            <div class="search-section">
              <button
                v-for="(value, index) in suggested"
                :key="`sug-${index}`"
                @click.prevent="makeSearch(value.title)"
                class="item lite-btn"
                aria-label="search"
              >
                {{ value.title }}
              </button>
            </div>
            <!--search-section-->
          </div>
          <div
            v-if="categories.length || subCategories.length"
            class="mb-15"
          >
            <h4 class="bold">
              {{ $t('searchPopup.categories') }}
            </h4>
            <div class="search-section category-wrapper">
              <router-link
                v-for="(value, index) in categories"
                :key="`c-${index}`"
                :to="categoryLink(value)"
                class="page-link center-text item">

                <div class="img-wrapper">
                  <lazy-image
                    :data-src="imageURL(value)"
                    :title="value.title"
                    :alt="value.title"
                    height="50"
                    width="50"
                  />
                </div>
                <h5
                  class="title ellipsis ellipsis-1"
                >
                  {{value.title}}
                </h5>
              </router-link>

              <router-link
                v-for="(value, index) in subCategories"
                :key="`sc-${index}`"
                :to="subCategoryLink(value, value.category)"
                class="page-link center-text item"
              >
                <div class="img-wrapper">
                  <lazy-image
                    :data-src="imageURL(value)"
                    :title="value.title"
                    :alt="value.title"
                    height="50"
                    width="50"
                  />
                </div>
                <h5
                  class="title ellipsis ellipsis-1"
                >
                  {{value.title}}
                </h5>

              </router-link>
            </div>
            <!--search-section-->
          </div>
          <div
            v-if="products.length"
            class="mb-15"
          >
            <h4 class="bold">
              {{ $t('searchPopup.products') }}
            </h4>
            <div
              class="search-section search-product-tile"
            >
              <searched-product-tile
                v-for="(value, index) in products"
                :key="`prod-${index}`"
                :product="value"
              />
            </div><!--search-section-->
          </div>
        </div>

        <div v-else>
          <h4>{{ $t('searchPopup.nothingFound') }} "<span class="color-primary semi-bold">{{ searchedText }}</span>"</h4>
        </div>

      </div>
    </div>
  </div>
</template>

<script>
  import {mapGetters, mapActions} from 'vuex'
  import util from '~/mixin/util'
  import {debounce} from "debounce";
  import SearchedProductTile from "./SearchedPorductTile";
  import LazyImage from "./LazyImage";
  import Spinner from "./Spinner";

  export default {
    name: 'SearchPopup',
    components: {Spinner, LazyImage, SearchedProductTile},
    directives: {},
    props: {
      searchedText: {
        type: String,
        default: '',
      }
    },
    mixins: [util],
    watch: {
      searchedText: debounce(function (value) {
        if(value){
          this.fetchData()
        }else{
          this.$emit('close')
        }
      }, 700)
    },
    computed: {
      matchedResult(){
        return this.products.length || this.suggested.length ||this.subCategories.length || this.categories.length
      },
      products(){
        return this.searchedSuggestion?.product || []
      },
      suggested(){
        return this.searchedSuggestion?.suggested || []
      },
      subCategories(){
        return this.searchedSuggestion?.sub_category || []
      },
      categories(){
        return this.searchedSuggestion?.category || []
      },
      ...mapGetters('language', ['langCode']),
      ...mapGetters('listing', ['searchedSuggestion', 'searched']),
    },
    data() {
      return {
        fetchingData: false
      }
    },
    methods: {
      makeSearch(searched){
        if(searched !== this.searched){
          this.$router.push({path: 'search', query: { q: searched}})
          this.updateSearch(searched)
        }
      },
      currentPricing(value){
        return value?.offered ? value?.offered : value?.selling
      },
      async fetchData() {
        this.fetchingData = true
        try {
          await this.fetchSearchedSuggestion({
            params: { q: this.searchedText },
            lang: this.langCode
          })

          this.fetchingData = false
        } catch (e) {
          this.fetchingData = false

          return this.$nuxt.error(e)
        }
      },
      ...mapActions('listing', ['fetchSearchedSuggestion', 'updateSearch']),
    },
    async mounted() {
      if(!this.searchedSuggestion){
        await this.fetchData()
      }
    },
    destroyed() {
    }
  }
</script>
