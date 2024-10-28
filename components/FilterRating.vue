<template>
  <div class="sidebar-section star-filter mt-xs-10 mb-xs-10">
    <h4 class="title">
      {{ $t('productReview.customerReviews') }}
    </h4>
    <button
      class="clear-btn"
      :disabled="!rating"
      aria-label="submit"
      @click.prevent="filterRating(0)"
    >
      {{ $t('listingLayout.clear') }}
    </button>
    <button
      class="mtb-5"
      aria-label="submit"
      :class="{active: parseInt(rating) === value}"
      v-for="value in 4"
      @click.prevent="filterRating(value)"
    >
      <rating-star
        :rating="value"
      />
      & {{ $t('listingLayout.up') }}
    </button>
  </div><!--sidebar-section-->
</template>

<script>


    import RatingStar from "./RatingStar";
    export default {
      name: "FilterRating",
      props: {

      },
      data() {
        return {
          rating: this.$route.query.rating || '',
        }
      },
      components: {
        RatingStar
      },
      mixins: [],
      computed: {

      },
      mounted() {


      },
      methods: {
        clearRating() {
          this.rating = ''
        },
        filterRating(rating) {
          let filtered = Object.assign({}, this.$route.query)
          this.rating = rating
          if (parseInt(rating) > 0 && parseInt(rating) <= 5) {
            filtered = {...filtered, ...{rating: rating}}
          } else {
            delete filtered.rating
          }

          this.$emit('reset-route', filtered)
        },
      },
    }
</script>

<style scoped>

</style>
