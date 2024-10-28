<template>
   <span
     :title="$t('ratingStar.outOf', {rating})"
     class="rating-stars"
   >
     <span>☆☆☆☆☆</span>
     <span class="rating" :style="ratingPercent">★★★★★</span>
   </span>
</template>

<script>

  export default {
    name: 'RatingStar',
    props: {
      rating: {
        type: Number,
        default: 5,
      }
    },
    data() {
      return {
      }
    },
    mixins: [],
    computed: {
      ratingPercent() {
        return {
          width: `${parseInt((this.rating / 5) * 100)}%`
        }
      },
    },
    mounted() {

    },
    methods: {

    },
  };
</script>

