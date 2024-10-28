<template>
  <router-link
    :to="productLink(product)"
    class="page-link center-text item"
  >
    <div class="item-inner">
      <div
        class="img-container"
      >
        <div class="img-wrapper">
          <lazy-image
            :data-src="thumbImageURL(product)"
            :title="product.title"
            :alt="product.title"
            height="50"
            width="50"
          />
        </div>
      </div>
      <div class="title-wrap">
        <h5
          class="ellipsis ellipsis-1 mb-5"
        >
          {{product.title}}
        </h5>
        <div class="pos-rel flex start">
          <h5>
            <span
              class="strike-through"
              v-if="prevPrice"
            >
              <price-format
                :price="prevPrice"
              />
            </span>
            <span class="f-12">
              <price-format
                :price="currentPricing"
              />
            </span>
          </h5>
          <span
            v-if="reducedPercent"
            class="discount ml-10"
          >
            -{{reducedPercent}}%
          </span>

          <button
            aria-label="submit"
            class="compare-btn"
            :title="$t('product.compare')"
            @click.prevent="addToCompare"
          >
            <i class="icon reload-icon"/>
          </button>
        </div>
      </div>
    </div>

  </router-link>
</template>

<script>
  import {mapGetters, mapActions} from 'vuex'
  import util from '~/mixin/util'
  import productPriceHelper from '~/mixin/productPriceHelper'
  import compareHelper from '~/mixin/compareHelper'
  import LazyImage from "./LazyImage";
  import PriceFormat from "./PriceFormat";


  export default {
    name: 'SearchedProductTile',
    components: {PriceFormat, LazyImage},
    directives: {},
    props: {
      product: {
        type: Object,
        default() {
          return null
        },
      },

    },
    mixins: [util, productPriceHelper, compareHelper],
    watch: {

    },
    computed: {
      ...mapGetters('common', ['currencyIcon', 'setting']),
    },

    data() {
      return {
      }
    },
    methods: {
      ...mapActions('common', ['postRequest', 'setToastMessage', 'setToastError'])
    },
    async mounted() {

    },
    destroyed() {
    }
  }
</script>
