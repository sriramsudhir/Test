<template>
  <nuxt-link
    class="block page-link"
    :to="categoryLink(subCategory)"
    :title="subCategory.title"
  >
    <div class="img-wrapper">
      <lazy-image
        :data-src="thumbImageURL(subCategory)"
        :title="subCategory.title"
        :alt="subCategory.title"
      />
    </div>
    <h5 class="item-title ellipsis ellipsis-1">
      {{ subCategory.title }}
    </h5>
  </nuxt-link>
</template>

<script>
  import LazyImage from '~/components/LazyImage'
  import util from '~/mixin/util'

  export default {
    name: 'SubCategoryTile',
    props: {
      category: {
        type: Object,
        default() {
          return null
        },
      },
      subCategory: {
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
      LazyImage
    },
    mixins: [util],
    computed: {
    },
    mounted() {
    },
    methods: {
    },
  };
</script>

