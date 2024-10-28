<template>
  <nuxt-link
    class="block page-link"
    :to="categoryLink(category)"
    :title="category.title"
  >
    <div class="img-wrapper">
      <lazy-image
        :data-src="thumbImageURL(category)"
        :title="category.title"
        :alt="category.title"
      />
    </div>
    <h5 class="item-title ellipsis ellipsis-1">
      {{ category.title }}
    </h5>
  </nuxt-link>
</template>

<script>
  import LazyImage from '~/components/LazyImage'
  import util from '~/mixin/util'

  export default {
    name: 'CategoryTile',
    props: {
      category: {
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

