<template>
  <div class="sticky-cart-wrap">
    <div class="container-fluid">

      <div class="sticky-cart">

        <div class="sticky-title">
          <lazy-image
            :data-src="thumbImageURL(product)"
            :title="productTitle"
            :alt="productTitle"
          />
          <h5 class="ellipsis ellipsis-2">{{ productTitle }}</h5>
        </div>


        <div class="btn-wrap">

          <ajax-button
            id="add-to-cart"
            class="primary-btn btn"
            :disabled="disabled"
            type="button"
            :fetching-data="ajaxing"
            @clicked="addToCart"
            :loading-text="$t('detailRight.adding')"
            :text="$t('detailRight.addToCart')"
          />
          <ajax-button
            class=" outline-btn btn"
            :disabled="disabled"
            type="button"
            color="primary"
            :fetching-data="buyingNow"
            @clicked="addToCart(true)"
            :loading-text="$t('detailRight.buyNow')"
            :text="$t('detailRight.buyNow')"
          />


          <button
            aria-label="submit"
            class="compare-btn"
            @click.prevent="wishListAction"
          >

            <spinner
              v-if="ajaxingWishlist"
              class="mr-15"
            />
            <i v-else class="icon" :class="favouriteIcon"/>
          </button>


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
  </div>

</template>

<script>
  import util from '~/mixin/util';
  import LazyImage from "./LazyImage";
  import AjaxButton from "./AjaxButton";
  import cartHelper from '~/mixin/cartHelper'
  import productHelper from '~/mixin/productHelper'
  import compareHelper from '~/mixin/compareHelper'
  import Spinner from "./Spinner";

  export default {
    name: 'StickyCartBtn',
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
      },
      disabled: {
        type: Boolean,
        default: false
      },
      productInventory: {
        type: Object
      }
    },
    components: {
      Spinner,
      AjaxButton,
      LazyImage

    },
    computed: {
      favouriteIcon(){
        return this.wishListed ? 'heart-fill-icon' : 'heart-icon'
      },

      productTitle() {
        return this.product?.title;
      },
    },
    mixins: [util, cartHelper, productHelper, compareHelper],
    methods: {},
    created() {
    },
    async mounted() {
    }
  }
</script>
