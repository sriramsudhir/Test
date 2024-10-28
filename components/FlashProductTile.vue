<template>
  <div class="p-tile">
    <nuxt-link
      :to="productLink(product)"
      class="block page-link"
      :title="product.title"
    >
      <div class="img-wrapper">
        <span
          v-if="product.badge"
          class="badge"
        >
          {{ product.badge }}
        </span>


        <button
          aria-label="submit"
          class="compare-btn"
          :title="$t('product.compare')"
          @click.prevent="addToCompare"
        >
          <i class="icon reload-icon"/>
        </button>

        <lazy-image
          :data-src="imageURL(product)"
          :title="product.title"
          :alt="product.title"
        />
      </div>

      <div class="flex wrap sided align-end item-title mt-0">
        <h4 class="price-wrapper">
          <span class="price">
            <price-format
              :price="reducedPrice"
            />
          </span>
          <span class="strike-through">
            <price-format
              :price="prevPrice"
            />
          </span>
        </h4>
        <h5
          class="color-primary"
        >
          <span class="discount">
            {{ $t('home.off', {percent: reducedPercent}) }}
          </span>
        </h5>

      </div>

    </nuxt-link>
  </div>
</template>

<script>
  import util from '~/mixin/util'
  import LazyImage from '~/components/LazyImage'
  import {mapGetters, mapActions} from 'vuex'
  import productPriceHelper from '~/mixin/productPriceHelper'
  import compareHelper from '~/mixin/compareHelper'
  import PriceFormat from "./PriceFormat";

  export default {
    name: 'FlashProductTile',
    data() {
      return {}
    },
    watch: {},
    props: {
      product: {
        type: Object,
        default() {
          return null
        },
      }
    },
    components: {
      PriceFormat,
      LazyImage
    },
    mixins: [util, productPriceHelper, compareHelper],
    computed: {
      reducedPrice() {
        return this.product?.price
      },
      quantity() {
        return this.product?.quantity || 0
      },
      reducedPercent() {
        return 100 - parseInt(((this.reducedPrice / this.prevPrice) * 100).toString())
      },
      sold() {
        return this.product?.sold || 0
      },
      remainingQtyStyle() {
        return {
          width: `${(this.sold / this.quantity) * 100}%`
        }
      },
      ...mapGetters('common', ['currencyIcon', 'setting'])
    },
    methods: {
      ...mapActions('common', ['postRequest', 'setToastMessage', 'setToastError'])
    },
    created() {
    },
    mounted() {
    }
  }
</script>
