<template>
  <div class="p-tile">
    <nuxt-link
      :title="product.title"
      :to="productLink(product)"
      class="page-link"
    >
      <span
        class="block img-wrapper"
      >
        <span
          v-if="badge"
          class="badge"
        >
          {{ badge }}
        </span>

        <slot name="floating-btn">
          <button
            aria-label="submit"
            class="compare-btn"
            :title="$t('product.compare')"
            @click.prevent="addToCompare"
          >
            <i class="icon reload-icon"/>
          </button>
        </slot>


        <lazy-image
          v-if="isLazyImage"
          :data-src="thumbImageURL(product)"
          :title="product.title"
          :alt="product.title"
        />
        <img
          v-else
          :src="thumbImageURL(product)"
          :title="product.title"
          :alt="product.title"
          height="50"
          width="50"
        >
      </span>

      <div class="item-title">
        <h5
          class="ellipsis"
          :class="`ellipsis-${titleEllipsis}`"
        >
          {{product.title}}
        </h5>
        <span class="block mtb-5">
          <rating-star
            :rating="parseFloat(product.rating)"
          />
          <span class="f-10 ml-5 semi-bold color-lite">
            {{ $t('productReview.reviews', {count: product.review_count}) }}</span>
        </span>
        <span class="flex wrap start">
          <h4 class="price-wrapper">
            <span
              class="strike-through"
              v-if="prevPrice"
            >
              <price-format
                :price="prevPrice"
              />
            </span>
            <span class="price">
              <price-format
                :price="currentPricing"
              />
            </span>
          </h4>
          <span
            v-if="reducedPercent"
            class="discount ml-10"
          >
            -{{reducedPercent}}%</span>
        </span>

      </div>
    </nuxt-link>
  </div>
</template>

<script>
  import LazyImage from '~/components/LazyImage'
  import util from '~/mixin/util'
  import productPriceHelper from '~/mixin/productPriceHelper'
  import productHelper from '~/mixin/productHelper'
  import compareHelper from '~/mixin/compareHelper'
  import { mapGetters, mapActions } from 'vuex'
  import PriceFormat from "./PriceFormat";
  import RatingStar from "./RatingStar";

  export default {
    name: 'ProductTile',
    props: {
      product: {
        type: Object,
        default() {
          return null
        },
      },
      isLazyImage: {
        type: Boolean,
        default: true
      },
      compared: {
        type: Boolean,
        default: false
      },
      titleEllipsis: {
        type: Number,
        default: 2
      },
    },
    data() {
      return {
        ajaxingCompare: false
      }
    },
    components: {
      RatingStar,
      PriceFormat,
      LazyImage
    },
    mixins: [util, productHelper, productPriceHelper, compareHelper],
    computed: {
      badge(){
        return this.product?.badge
      },
      ...mapGetters('common', ['currencyIcon', 'setting'])
    },
    mounted() {
    },
    methods: {

      ...mapActions('common', ['postRequest', 'setToastMessage', 'setToastError'])
    },
  };
</script>

