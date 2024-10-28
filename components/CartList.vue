<template>
  <div>
    <transition name="fade" mode="out-in">
      <div
        class="spinner-wrapper flex"
        v-if="fetchingCartData || ajaxing"
      >
        <spinner
          :radius="100"
        />
      </div>
      <div v-else>
        <cart-product-tile
          v-for="(value) in cartProducts"
          :key="value.id"
          :cart="value"
          :checked="checked"
          :is-shipping="isShipping"
          :cart-shipping="cartShipping"
          :current-addresses="currentAddresses"
          :address="address"
          :error="dataFromObject(errorFromApi, value.id, null)"
          @cb-changed="cbChangedFn"
          @deleting="deleting"
          @quantity="valueChanged"
          @update-cart-shipping="updateCartShipping"
          @current-shipping="currentShipping"
        />
    </div>
    </transition>
  </div>
</template>

<script>
  import { mapGetters, mapActions } from 'vuex'
  import LazyImage from '~/components/LazyImage'
  import util from '~/mixin/util'
  import QuantityNav from '~/components/QuantityNav'
  import CartProductTile from "~/components/CartProductTile";
  import Spinner from "~/components/Spinner";

  export default {
    name: 'CartList',
    data() {
      return {
        fetchingCartData: false,
        ajaxDeleting: 0,
      }
    },
    watch: {
    },
    props: {
      cartProducts: {
        type: Array
      },
      checked: {
        type: Array
      },
      cartShipping: {
        type: Object,
        default() {
          return null
        }
      },
      isShipping: {
        type: Boolean,
        default: false
      },
      ajaxing: {
        type: Boolean,
        default: false
      },
      currentAddresses: {
        type: Array,
        default(){
          return []
        }
      },
      errorFromApi: {
        type: Object,
        default(){
          return null
        }
      },
      address: {
        type: Object,
        default(){
          return null
        }
      },
    },
    components: {
      Spinner,
      CartProductTile,
      QuantityNav,
      LazyImage
    },
    computed: {
      ...mapGetters('language', ['langCode']),
    },
    mixins: [util],
    methods: {
      currentShipping(evt){
        this.$emit('current-shipping', evt)
      },
      updateCartShipping(){
        this.$emit('shipping-changed', this.cartShipping)
      },
      async valueChanged({bundleDeal, product, inventory, direction}){
        try {
          await this.cartAction({
            payload: {
              apiVal:{
                user_token: await this.getUserToken(),
                product_id: product.id,
                inventory_id: inventory.id,
                quantity: direction
              },
              storeVal:{
                product: product,
                inventory: inventory,
                quantity: direction,
                selected: '1'
              },
              isBundle: !!bundleDeal
            },
            lang: this.langCode
          })
        }catch (e) {
          this.$nuxt.error(e)
        }
      },
      async deleting(evt){

        try {
          await this.cartDelete({
            payload: evt,
            lang: this.langCode
          })
        }catch (e) {
          this.$nuxt.error(e)
        }
      },
      async cbChangedFn(evt){
        const cbChecked = this.checked
        if(evt.checked.target.checked) {
          cbChecked.push(evt.id)
        } else {
          const index = this.checked.findIndex((obj)=>{
            return parseInt(obj) === parseInt(evt.id)
          })
          delete cbChecked[index]
        }

        await this.cartChanged({
          lang: this.langCode,
          payload: {
            checked: cbChecked
          }
        })
        this.$emit('cart-changed', true)
      },
      ...mapActions('user', ['getUserToken']),
      ...mapActions('cart', ['cartDelete', 'cartAction', 'cartChanged'])
    },
    created() {
    },
    mounted() {
    }
  }
</script>



