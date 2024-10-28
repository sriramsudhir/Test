<template>
  <product-tile
    ref="tile"
    :product="product"
    @removed="$emit('removed')"
  >
    <template
      v-slot:floating-btn
    >
      <button
        class="compare-btn"
        aria-label="compare"
        :title="$t('product.removeCompare')"
        @click.prevent="removeFromCompared"
      >
        <i class="icon close-icon"/>
      </button>
    </template>
  </product-tile>
</template>

<script>
  import ProductTile from '~/components/ProductTile'


  export default {
    name: 'ComparedTile',
    props: {
      product: {
        type: Object,
        default() {
          return null
        },
      },
    },
    data() {
      return {
      }
    },
    components: {
      ProductTile
    },
    mixins: [],
    computed: {
    },
    mounted() {
    },
    methods: {
      removeFromCompared(){
        this.$refs.tile.addToCompare()
      }
    }
  };
</script>

