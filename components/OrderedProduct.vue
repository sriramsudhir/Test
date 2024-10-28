<template>
                <tr
                >
                  <td>
                    <nuxt-link
                      :to="productLink(cart.product)"
                      class="img-wrap"
                      :title="cart.product.title"
                    >
                      <lazy-image
                        :data-src="getThumbImageURL(productImage)"
                        :title="cart.product.title"
                        :alt="cart.product.title"
                      />

                    </nuxt-link>
                  </td>
                  <td class="mn-w-200x-md">
                    <nuxt-link
                      :to="productLink(cart.product)"
                      :title="cart.product.title"
                      class="mb-5 block"
                    >
                      {{ cart.product.title }}
                    </nuxt-link>
                    <span
                      class="block"
                    >
                     <span class="mr-15" v-for="i in currentAttribute">
                        <b class="mr-10">{{i[0]}}</b> : {{i[1]}}
                    </span>
                  </span>
                    <button
                      v-if="!!!ordered.cancelled"
                      aria-label="submit"
                      class="link-color"
                      @click.prevent="$emit('rate-now', cart.product.id)">
                      {{ $t('ratePopup.rateNow') }}
                    </button>
                  </td>
                  <td>{{ shippingTypes[cart.shipping_type] }}</td>
                  <td>
                    <price-format
                      :price="cart.shipping_price"
                    />
                  </td>
                  <td>{{ cart.quantity }}</td>
                  <td>
                    <price-format
                      :price="cart.selling * dataFromObject(cart, 'bundle_offer', 0)"
                    />
                  </td>
                  <td>
                    <price-format
                      :price="cart.selling"
                    />
                  </td>
                  <td>
                    <price-format
                      :price="cart.selling * cart.quantity"
                    />
                  </td>
                </tr>
</template>

<script>

  import util from '~/mixin/util'
  import PriceFormat from "./PriceFormat";
  import LazyImage from "./LazyImage";
  import productImageHelper from '~/mixin/productImageHelper'
  export default {
    middleware: ['common-middleware'],

    data() {
      return {

      }
    },
    props: {
      ordered: {
        type: Object
      },
      cart: {
        type: Object
      },
    },
    components: {
      LazyImage,
      PriceFormat
    },
    mixins: [util, productImageHelper],
    computed: {
      productImages(){
        return this.cart?.product_images
      },
      product(){
        return this.cart?.product
      },
      inventoryAttributes(){
        return this.cart?.updated_inventory?.inventory_attributes
      },
      currentAttribute() {
        return this.inventoryAttributes?.map(i => {
          return [i?.attribute_value?.attribute?.title, i?.attribute_value?.title]
        })
      },
    },
    methods: {

    },
    async mounted() {

    },
  }
</script>

<style>

</style>
