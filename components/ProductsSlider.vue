<template>
  <div
    v-if="itemList.product_collections.length"
    class="area home-section"
  >
    <div class="flex sided title">
      <h4>{{ title }}</h4>
      <nuxt-link
        class="link"
        :to="collectionLink(linkObj)"
      >
        {{ $t('featured.showAll') }}
      </nuxt-link>
    </div>

    <div class="area-content shimmer-wrapper">
      <image-slider
        :per-view="perView"
        :gap="20"
        :responsive="perViewResponsive"
      >
        <template v-slot:content>

          <li
            v-for="(value, index) in itemList.product_collections"
            :key="index"
          >
            <product-tile
              :product="value"
            />
          </li>
        </template>

      </image-slider>
    </div>
  </div>
</template>

<script>
  import util from '~/mixin/util'
  import ImageSlider from '~/components/ImageSlider'
  import ProductTile from '~/components/ProductTile'
  import TileShimmer from '~/components/TileShimmer'

  export default {
    name: 'ProductsSlider',
    data() {
      return {}
    },
    watch: {},
    props: {
      collection: {
        type: Object
      },
      perView: {
        type: Number,
        default: 6
      },
      perViewResponsive: {
        type: Array,
        default(){
          return [5, 4, 3, 2, 2]
        }
      },
    },
    components: {
      ImageSlider,
      ProductTile,
      TileShimmer
    },
    computed: {
      itemList() {
        return this.collection
      },
      title() {
        return this.collection?.title
      },
      slug() {
        return this.collection?.slug
      },
      linkObj() {
        return {
          slug: this.slug,
          title: this.title,
          id: this.collection?.id
        }
      },
    },
    mixins: [util],
    methods: {},
    created() {
    },
    mounted() {
    }
  }
</script>

